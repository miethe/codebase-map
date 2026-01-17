from __future__ import annotations

import argparse
import ast
import re
from pathlib import Path
from typing import Any, Dict, Iterable, Optional, Tuple

try:
    from .graph import Graph
    from .metadata_utils import (
        build_common_metadata,
        doc_summary_from_docstring,
        format_class_signature,
        span_from_ast,
    )
except ImportError:  # pragma: no cover - fallback for direct script execution
    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    from scripts.code_map.graph import Graph
    from scripts.code_map.metadata_utils import (
        build_common_metadata,
        doc_summary_from_docstring,
        format_class_signature,
        span_from_ast,
    )

MIGRATION_REVISION_RE = re.compile(r"^revision\s*=\s*['\"]([^'\"]+)['\"]", re.MULTILINE)
MIGRATION_DOWN_RE = re.compile(r"^down_revision\s*=\s*['\"]([^'\"]+)['\"]", re.MULTILINE)
CREATE_TABLE_RE = re.compile(r"create_table\(\s*['\"]([^'\"]+)['\"]")
DROP_TABLE_RE = re.compile(r"drop_table\(\s*['\"]([^'\"]+)['\"]")


def _format_expr(node: ast.AST) -> str:
    try:
        return ast.unparse(node)
    except Exception:
        if isinstance(node, ast.Name):
            return node.id
        if isinstance(node, ast.Attribute):
            return node.attr
        if isinstance(node, ast.Constant):
            return str(node.value)
    return ""


def _column_from_call(target: str, call: ast.Call) -> Optional[Dict[str, Any]]:
    column_type = None
    if call.args:
        column_type = _format_expr(call.args[0])
        if isinstance(call.args[0], ast.Constant) and isinstance(call.args[0].value, str):
            if len(call.args) > 1:
                column_type = _format_expr(call.args[1])
    nullable = None
    primary_key = None
    for keyword in call.keywords or []:
        if keyword.arg == "nullable" and isinstance(keyword.value, ast.Constant):
            nullable = bool(keyword.value.value)
        if keyword.arg == "primary_key" and isinstance(keyword.value, ast.Constant):
            primary_key = bool(keyword.value.value)
    return {
        "name": target,
        "type": column_type,
        "nullable": nullable,
        "pk": primary_key,
    }


def _relationship_from_call(
    target: str,
    call: ast.Call,
    annotation: Optional[ast.AST],
) -> Optional[Dict[str, Any]]:
    if not call.args:
        return None
    rel_target = _format_expr(call.args[0])
    if isinstance(call.args[0], ast.Constant) and isinstance(call.args[0].value, str):
        rel_target = call.args[0].value
    cardinality = "many_to_one"
    if annotation and "List" in _format_expr(annotation):
        cardinality = "one_to_many"
    for keyword in call.keywords or []:
        if keyword.arg == "uselist" and isinstance(keyword.value, ast.Constant):
            if bool(keyword.value.value):
                cardinality = "one_to_many"
            else:
                cardinality = "many_to_one"
    return {
        "target": rel_target,
        "cardinality": cardinality,
    }


def parse_model_details(path: Path) -> Dict[str, Dict[str, Any]]:
    text = path.read_text(encoding="utf-8")
    try:
        tree = ast.parse(text)
    except SyntaxError:
        return {}
    details: Dict[str, Dict[str, Any]] = {}
    for node in tree.body:
        if not isinstance(node, ast.ClassDef):
            continue
        table_name = None
        columns: list[Dict[str, Any]] = []
        relationships: list[Dict[str, Any]] = []
        indexes: list[str] = []
        for stmt in node.body:
            if isinstance(stmt, ast.Assign):
                for target in stmt.targets:
                    if isinstance(target, ast.Name) and target.id == "__tablename__":
                        if isinstance(stmt.value, ast.Constant) and isinstance(
                            stmt.value.value, str
                        ):
                            table_name = stmt.value.value
                    if isinstance(target, ast.Name) and target.id == "__table_args__":
                        table_args = stmt.value
                        if isinstance(table_args, (ast.Tuple, ast.List)):
                            for item in table_args.elts:
                                if isinstance(item, ast.Call) and _format_expr(item.func) in {
                                    "Index",
                                    "UniqueConstraint",
                                }:
                                    if item.args and isinstance(item.args[0], ast.Constant):
                                        indexes.append(str(item.args[0].value))
            if isinstance(stmt, ast.AnnAssign) and isinstance(stmt.target, ast.Name):
                target_name = stmt.target.id
                if isinstance(stmt.value, ast.Call):
                    func_name = _format_expr(stmt.value.func)
                    if func_name in {"mapped_column", "Column"}:
                        column = _column_from_call(target_name, stmt.value)
                        if column:
                            columns.append(column)
                    if func_name == "relationship":
                        relationship = _relationship_from_call(
                            target_name, stmt.value, stmt.annotation
                        )
                        if relationship:
                            relationships.append(relationship)
        details[node.name] = {
            "line": node.lineno,
            "span": span_from_ast(node),
            "doc_summary": doc_summary_from_docstring(ast.get_docstring(node)),
            "signature": format_class_signature(node),
            "table": table_name,
            "columns": columns or None,
            "relationships": relationships or None,
            "indexes": sorted(set(indexes)) or None,
        }
    return details


def iter_schema_files(api_root: Path) -> Iterable[Path]:
    schemas_root = api_root / "schemas"
    if schemas_root.exists():
        yield from schemas_root.rglob("*.py")


def iter_migration_files(cache_root: Path) -> Iterable[Path]:
    migrations_root = cache_root / "migrations" / "versions"
    if migrations_root.exists():
        yield from migrations_root.rglob("*.py")


def parse_schema_classes(path: Path) -> Dict[str, Dict[str, Any]]:
    text = path.read_text(encoding="utf-8")
    try:
        tree = ast.parse(text)
    except SyntaxError:
        return {}
    classes: Dict[str, Dict[str, Any]] = {}
    for node in tree.body:
        if isinstance(node, ast.ClassDef):
            classes[node.name] = {
                "line": node.lineno,
                "span": span_from_ast(node),
                "doc_summary": doc_summary_from_docstring(ast.get_docstring(node)),
                "signature": format_class_signature(node),
            }
    return classes


def parse_models(path: Path) -> Dict[str, Tuple[int, Optional[str]]]:
    text = path.read_text(encoding="utf-8")
    try:
        tree = ast.parse(text)
    except SyntaxError:
        return {}
    models: Dict[str, Tuple[int, Optional[str]]] = {}
    for node in tree.body:
        if not isinstance(node, ast.ClassDef):
            continue
        table_name = None
        for stmt in node.body:
            if isinstance(stmt, ast.Assign):
                for target in stmt.targets:
                    if isinstance(target, ast.Name) and target.id == "__tablename__":
                        if isinstance(stmt.value, ast.Constant) and isinstance(
                            stmt.value.value, str
                        ):
                            table_name = stmt.value.value
        models[node.name] = (node.lineno, table_name)
    return models


def parse_repository_models(path: Path) -> Dict[str, str]:
    text = path.read_text(encoding="utf-8")
    try:
        tree = ast.parse(text)
    except SyntaxError:
        return {}
    repo_models: Dict[str, str] = {}
    for node in tree.body:
        if not isinstance(node, ast.ClassDef):
            continue
        for base in node.bases:
            if isinstance(base, ast.Subscript):
                if isinstance(base.value, ast.Name) and base.value.id.endswith("Repository"):
                    if isinstance(base.slice, ast.Name):
                        repo_models[node.name] = base.slice.id
                if isinstance(base.value, ast.Attribute) and base.value.attr.endswith("Repository"):
                    if isinstance(base.slice, ast.Name):
                        repo_models[node.name] = base.slice.id
            if isinstance(base, ast.Name) and base.id.endswith("Repository"):
                repo_models.setdefault(node.name, "")
    return repo_models


def migration_info(path: Path) -> Tuple[Optional[str], Optional[str], list[str]]:
    text = path.read_text(encoding="utf-8")
    revision_match = MIGRATION_REVISION_RE.search(text)
    revision = revision_match.group(1) if revision_match else None
    down_match = MIGRATION_DOWN_RE.search(text)
    down_revision = down_match.group(1) if down_match else None
    tables = CREATE_TABLE_RE.findall(text)
    tables.extend(DROP_TABLE_RE.findall(text))
    return revision, down_revision, sorted(set(tables))


def extract_backend_models(repo_root: Path) -> Graph:
    graph = Graph(source="backend")
    api_root = repo_root / "skillmeat" / "api"
    cache_root = repo_root / "skillmeat" / "cache"

    for schema_file in iter_schema_files(api_root):
        classes = parse_schema_classes(schema_file)
        for name, info in classes.items():
            graph.add_node(
                f"schema:{schema_file.as_posix()}::{name}",
                "schema",
                label=name,
                file=schema_file.as_posix(),
                line=info.get("line"),
                symbol=name,
                **build_common_metadata(
                    schema_file,
                    span=info.get("span"),
                    signature=info.get("signature"),
                    doc_summary=info.get("doc_summary"),
                ),
            )

    models_path = cache_root / "models.py"
    model_tables: Dict[str, Optional[str]] = {}
    if models_path.exists():
        model_details = parse_model_details(models_path)
        for name, info in model_details.items():
            table_name = info.get("table")
            model_tables[name] = table_name
            graph.add_node(
                f"model:{models_path.as_posix()}::{name}",
                "model",
                label=name,
                file=models_path.as_posix(),
                line=info.get("line"),
                table=table_name,
                columns=info.get("columns"),
                relationships=info.get("relationships"),
                indexes=info.get("indexes"),
                **build_common_metadata(
                    models_path,
                    span=info.get("span"),
                    signature=info.get("signature"),
                    doc_summary=info.get("doc_summary"),
                ),
            )

    repo_paths = [cache_root / "repositories.py", cache_root / "repository.py"]
    for repo_path in repo_paths:
        if not repo_path.exists():
            continue
        repo_models = parse_repository_models(repo_path)
        for repo_name, model_name in repo_models.items():
            repo_id = f"repository:{repo_path.as_posix()}::{repo_name}"
            graph.add_node(
                repo_id,
                "repository",
                label=repo_name,
                file=repo_path.as_posix(),
                side_effects=["db"],
                **build_common_metadata(repo_path, symbol=repo_name),
            )
            if model_name:
                model_id = f"model:{models_path.as_posix()}::{model_name}"
                graph.add_node(
                    model_id,
                    "model",
                    label=model_name,
                    file=models_path.as_posix(),
                )
                graph.add_edge(repo_id, model_id, "repository_uses_model")

    migration_tables: Dict[str, list[str]] = {}
    for migration_file in iter_migration_files(cache_root):
        revision, down_revision, tables = migration_info(migration_file)
        revision_id = revision or migration_file.stem
        migration_id = f"migration:{migration_file.as_posix()}::{revision_id}"
        graph.add_node(
            migration_id,
            "migration",
            label=revision_id,
            file=migration_file.as_posix(),
            revision=revision,
            down_revision=down_revision,
            tables=tables or None,
            **build_common_metadata(migration_file, symbol=revision_id),
        )
        if tables:
            migration_tables[migration_id] = tables

    if model_tables and migration_tables:
        for model_name, table_name in model_tables.items():
            if not table_name:
                continue
            model_id = f"model:{models_path.as_posix()}::{model_name}"
            for migration_id, tables in migration_tables.items():
                if table_name in tables:
                    graph.add_edge(model_id, migration_id, "model_migrated_by")

    return graph


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract backend schema/model/migration graph.")
    parser.add_argument(
        "--repo-root",
        default=".",
        help="Repository root (default: .)",
    )
    parser.add_argument(
        "--out",
        default="docs/architecture/codebase-graph/codebase-graph.backend.models.json",
        help="Output JSON path",
    )
    args = parser.parse_args()

    graph = extract_backend_models(Path(args.repo_root).resolve())
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    graph.write_json(args.out)


if __name__ == "__main__":
    main()
