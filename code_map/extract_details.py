from __future__ import annotations

import argparse
import ast
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

try:
    from .metadata_utils import (
        doc_summary_from_docstring,
        format_class_signature,
        format_python_signature,
        jsdoc_block,
        signature_from_line,
    )
except ImportError:  # pragma: no cover - fallback for direct script execution
    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    from scripts.code_map.metadata_utils import (
        doc_summary_from_docstring,
        format_class_signature,
        format_python_signature,
        jsdoc_block,
        signature_from_line,
    )

IMPORT_RE = re.compile(r"import\s+[^;]+?\s+from\s+['\"]([^'\"]+)['\"]", re.DOTALL)
EXPORT_FUNC_RE = re.compile(r"export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)\b")
EXPORT_CONST_RE = re.compile(r"export\s+const\s+([A-Za-z0-9_]+)\b")
EXPORT_CLASS_RE = re.compile(r"export\s+class\s+([A-Za-z0-9_]+)\b")


def _utc_now_iso() -> str:
    return (
        datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def _load_graph(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _edge_key(edge: Dict[str, Any]) -> Optional[str]:
    if edge.get("id"):
        return edge["id"]
    edge_from = edge.get("from")
    edge_to = edge.get("to")
    edge_type = edge.get("type")
    if edge_from and edge_to and edge_type:
        return f"{edge_from}->{edge_to}:{edge_type}"
    return None


def _decorator_label(decorator: ast.AST) -> Optional[str]:
    target = decorator.func if isinstance(decorator, ast.Call) else decorator
    if isinstance(target, ast.Attribute):
        if isinstance(target.value, ast.Name):
            return f"{target.value.id}.{target.attr}"
        return target.attr
    if isinstance(target, ast.Name):
        return target.id
    return None


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


def _param_names(node: ast.AST) -> list[str]:
    if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        return []
    params: list[str] = []
    for arg in node.args.posonlyargs:
        params.append(arg.arg)
    for arg in node.args.args:
        params.append(arg.arg)
    if node.args.vararg:
        params.append(f"*{node.args.vararg.arg}")
    for arg in node.args.kwonlyargs:
        params.append(arg.arg)
    if node.args.kwarg:
        params.append(f"**{node.args.kwarg.arg}")
    return params


def _python_details(path: Path) -> Dict[str, Dict[str, Any]]:
    text = path.read_text(encoding="utf-8")
    try:
        tree = ast.parse(text)
    except SyntaxError:
        return {}
    imports: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            if node.module:
                imports.append(node.module)
        elif isinstance(node, ast.Import):
            for alias in node.names:
                imports.append(alias.name)
    imports = sorted(set(imports))
    details: Dict[str, Dict[str, Any]] = {}
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            decorators = [
                label for label in (_decorator_label(d) for d in node.decorator_list) if label
            ]
            details[node.name] = {
                "docstring": ast.get_docstring(node),
                "signature": format_python_signature(node),
                "decorators": decorators or None,
                "params": _param_names(node) or None,
                "returns": _format_expr(node.returns) if node.returns else None,
                "imports": imports or None,
            }
        elif isinstance(node, ast.ClassDef):
            decorators = [
                label for label in (_decorator_label(d) for d in node.decorator_list) if label
            ]
            details[node.name] = {
                "docstring": ast.get_docstring(node),
                "signature": format_class_signature(node),
                "decorators": decorators or None,
                "imports": imports or None,
            }
    return details


def _parse_ts_params(signature: Optional[str]) -> Optional[list[str]]:
    if not signature:
        return None
    if "(" not in signature or ")" not in signature:
        return None
    params = signature.split("(", 1)[-1].rsplit(")", 1)[0]
    items = [item.strip() for item in params.split(",") if item.strip()]
    return items or None


def _ts_details(path: Path) -> Dict[str, Dict[str, Any]]:
    text = path.read_text(encoding="utf-8")
    imports = sorted(set(IMPORT_RE.findall(text)))
    details: Dict[str, Dict[str, Any]] = {}
    for regex in (EXPORT_FUNC_RE, EXPORT_CONST_RE, EXPORT_CLASS_RE):
        for match in regex.finditer(text):
            name = match.group(1)
            docstring = jsdoc_block(text, match.start())
            signature = signature_from_line(text, match.start())
            details[name] = {
                "docstring": docstring,
                "signature": signature,
                "params": _parse_ts_params(signature),
                "imports": imports or None,
            }
    return details


def extract_details(graph_path: Path, out_path: Path) -> Dict[str, Any]:
    graph = _load_graph(graph_path)
    nodes = graph.get("nodes", [])
    edges = graph.get("edges", [])

    payload: Dict[str, Any] = {
        "generated_at": graph.get("generated_at") or _utc_now_iso(),
        "source_commit": graph.get("source_commit") or "unknown",
        "nodes": {},
        "edges": {},
    }

    python_cache: Dict[Path, Dict[str, Dict[str, Any]]] = {}
    ts_cache: Dict[Path, Dict[str, Dict[str, Any]]] = {}

    for node in nodes:
        file_path = node.get("file")
        symbol = node.get("symbol")
        if not file_path or not symbol:
            continue
        path = Path(file_path)
        if not path.exists():
            continue
        details = None
        if path.suffix == ".py":
            file_details = python_cache.setdefault(path, _python_details(path))
            details = file_details.get(symbol)
        elif path.suffix in {".ts", ".tsx", ".js", ".jsx"}:
            file_details = ts_cache.setdefault(path, _ts_details(path))
            details = file_details.get(symbol)
        if not details:
            continue
        if not details.get("signature"):
            details["signature"] = node.get("signature")
        if not details.get("docstring"):
            details["docstring"] = node.get("doc_summary")
        if details.get("docstring"):
            details["doc_summary"] = doc_summary_from_docstring(details.get("docstring"))
        payload["nodes"][node["id"]] = details

    for edge in edges:
        key = _edge_key(edge)
        if not key:
            continue
        callsite_file = edge.get("callsite_file")
        callsite_line = edge.get("callsite_line")
        notes_parts = []
        for field in ("via", "method_name", "role"):
            if edge.get(field):
                notes_parts.append(f"{field}={edge[field]}")
        entry: Dict[str, Any] = {}
        if callsite_file or callsite_line:
            entry["callsite"] = {"file": callsite_file, "line": callsite_line}
        if notes_parts:
            entry["notes"] = ", ".join(notes_parts)
        if entry:
            payload["edges"][key] = entry

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=True)
        handle.write("\n")
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract detailed node/edge metadata.")
    parser.add_argument(
        "--graph",
        default="docs/architecture/codebase-graph/codebase-graph.unified.json",
        help="Unified graph JSON path",
    )
    parser.add_argument(
        "--out",
        default="docs/architecture/codebase-graph/codebase-graph.details.json",
        help="Output details JSON path",
    )
    args = parser.parse_args()

    extract_details(Path(args.graph), Path(args.out))


if __name__ == "__main__":
    main()
