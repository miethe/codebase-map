from __future__ import annotations

import argparse
import ast
from pathlib import Path
from typing import Dict, Iterable, Optional, Set, Tuple

try:
    from .backend_utils import module_to_path
    from .graph import Graph
    from .metadata_utils import (
        build_common_metadata,
        doc_summary_from_docstring,
        format_class_signature,
        format_python_signature,
        infer_side_effects,
        span_from_ast,
    )
except ImportError:  # pragma: no cover - fallback for direct script execution
    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    from scripts.code_map.backend_utils import module_to_path
    from scripts.code_map.graph import Graph
    from scripts.code_map.metadata_utils import (
        build_common_metadata,
        doc_summary_from_docstring,
        format_class_signature,
        format_python_signature,
        infer_side_effects,
        span_from_ast,
    )

REPO_MODULES = ("skillmeat.cache.repositories", "skillmeat.cache.repository")


def iter_service_files(api_root: Path) -> Iterable[Path]:
    core_services = api_root.parent / "core" / "services"
    if core_services.exists():
        yield from core_services.rglob("*.py")
    api_services = api_root / "services"
    if api_services.exists():
        yield from api_services.rglob("*.py")
    services_root = api_root.parent / "services"
    if services_root.exists():
        yield from services_root.rglob("*.py")


def parse_imports(tree: ast.AST) -> Dict[str, str]:
    imports: Dict[str, str] = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            module = node.module or ""
            if module.startswith(REPO_MODULES):
                for alias in node.names:
                    name = alias.asname or alias.name
                    imports[name] = module
        elif isinstance(node, ast.Import):
            for alias in node.names:
                module = alias.name
                if module.startswith(REPO_MODULES):
                    name = alias.asname or alias.name.split(".")[-1]
                    imports[name] = module
    return imports


def _collect_import_modules(tree: ast.AST) -> Set[str]:
    modules: Set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            if node.module:
                modules.add(node.module)
        elif isinstance(node, ast.Import):
            for alias in node.names:
                modules.add(alias.name)
    return modules


def _build_parent_map(tree: ast.AST) -> Dict[ast.AST, ast.AST]:
    parents: Dict[ast.AST, ast.AST] = {}
    for parent in ast.walk(tree):
        for child in ast.iter_child_nodes(parent):
            parents[child] = parent
    return parents


def _format_expr(node: ast.AST) -> str:
    try:
        return ast.unparse(node)
    except Exception:
        if isinstance(node, ast.Name):
            return node.id
        if isinstance(node, ast.Attribute):
            return node.attr
    return ""


def repo_node_id(module: str, name: str) -> str:
    repo_path = module_to_path(module)
    if repo_path:
        return f"repository:{repo_path.as_posix()}::{name}"
    return f"repository:{module}::{name}"


def service_node_id(path: Path, name: str) -> str:
    return f"service:{path.as_posix()}::{name}"


def extract_backend_services(api_root: Path) -> Graph:
    graph = Graph(source="backend")

    for service_file in iter_service_files(api_root):
        text = service_file.read_text(encoding="utf-8")
        try:
            tree = ast.parse(text)
        except SyntaxError:
            continue

        repo_imports = parse_imports(tree)
        import_modules = _collect_import_modules(tree)
        side_effects = infer_side_effects(import_modules)
        parent_map = _build_parent_map(tree)
        dependencies_by_service: Dict[str, Set[str]] = {}

        for node in tree.body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                name = node.name
                docstring = ast.get_docstring(node)
                span = span_from_ast(node)
                signature = (
                    format_python_signature(node)
                    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
                    else format_class_signature(node)
                )
                base_class = None
                if isinstance(node, ast.ClassDef) and node.bases:
                    base_class = _format_expr(node.bases[0])
                async_flag = isinstance(node, ast.AsyncFunctionDef) if isinstance(
                    node, (ast.FunctionDef, ast.AsyncFunctionDef)
                ) else None
                graph.add_node(
                    service_node_id(service_file, name),
                    "service",
                    label=name,
                    file=service_file.as_posix(),
                    line=node.lineno,
                    symbol=name,
                    is_async=async_flag,
                    base_class=base_class,
                    side_effects=side_effects or None,
                    **build_common_metadata(
                        service_file,
                        span=span,
                        signature=signature,
                        doc_summary=doc_summary_from_docstring(docstring),
                    ),
                )

        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                service_name = node.name
                for child in ast.walk(node):
                    if isinstance(child, ast.Call):
                        target_name = None
                        method_name = None
                        if isinstance(child.func, ast.Name):
                            target_name = child.func.id
                            method_name = child.func.id
                        elif isinstance(child.func, ast.Attribute) and isinstance(
                            child.func.value, ast.Name
                        ):
                            target_name = child.func.value.id
                            method_name = child.func.attr
                        if not target_name:
                            continue
                        module = repo_imports.get(target_name)
                        if not module and target_name.endswith("Repository"):
                            module = REPO_MODULES[0]
                        if not module:
                            continue
                        dependencies_by_service.setdefault(service_name, set()).add(target_name)
                        graph.add_node(
                            repo_node_id(module, target_name),
                            "repository",
                            label=target_name,
                            file=(module_to_path(module) or service_file).as_posix(),
                            side_effects=["db"],
                            **build_common_metadata(
                                module_to_path(module) or service_file,
                                symbol=target_name,
                            ),
                        )
                        graph.add_edge(
                            service_node_id(service_file, service_name),
                            repo_node_id(module, target_name),
                            "service_calls_repository",
                            callsite_file=service_file.as_posix(),
                            callsite_line=child.lineno,
                            awaited=isinstance(parent_map.get(child), ast.Await),
                            method_name=method_name,
                        )

        for service_name, deps in dependencies_by_service.items():
            node_id = service_node_id(service_file, service_name)
            node = graph.nodes.get(node_id)
            if node and deps:
                node["dependencies"] = sorted(deps)

    return graph


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract backend service and repository usage.")
    parser.add_argument(
        "--api-root",
        default="skillmeat/api",
        help="Path to API root (default: skillmeat/api)",
    )
    parser.add_argument(
        "--out",
        default="docs/architecture/codebase-graph/codebase-graph.backend.services.json",
        help="Output JSON path",
    )
    args = parser.parse_args()

    graph = extract_backend_services(Path(args.api_root))
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    graph.write_json(args.out)


if __name__ == "__main__":
    main()
