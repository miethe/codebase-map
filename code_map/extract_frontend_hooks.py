from __future__ import annotations

import argparse
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

try:
    from .graph import Graph
    from .frontend_utils import (
        normalize_literal,
        parse_imports,
        resolve_module_path,
        to_pascal_case,
    )
    from .metadata_utils import build_common_metadata, jsdoc_summary, offset_to_line_column, signature_from_line
except ImportError:  # pragma: no cover - fallback for direct script execution
    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    from scripts.code_map.graph import Graph
    from scripts.code_map.frontend_utils import (
        normalize_literal,
        parse_imports,
        resolve_module_path,
        to_pascal_case,
    )
    from scripts.code_map.metadata_utils import (
        build_common_metadata,
        jsdoc_summary,
        offset_to_line_column,
        signature_from_line,
    )

EXPORT_FUNC_RE = re.compile(r"export\s+function\s+(use[A-Za-z0-9_]+)\b")
EXPORT_CONST_RE = re.compile(r"export\s+const\s+(use[A-Za-z0-9_]+)\b")
COMPONENT_EXPORT_FUNC_RE = re.compile(r"export\s+(?:async\s+)?function\s+([A-Z][A-Za-z0-9_]*)")
COMPONENT_EXPORT_CLASS_RE = re.compile(r"export\s+class\s+([A-Z][A-Za-z0-9_]*)")
COMPONENT_EXPORT_CONST_RE = re.compile(r"export\s+const\s+([A-Z][A-Za-z0-9_]*)\b")
QUERY_KEY_PROP_RE = re.compile(
    r"queryKey\s*:\s*(\[[^\]]+\]|['\"][^'\"]+['\"])",
    re.DOTALL,
)
USE_QUERY_RE = re.compile(
    r"use(?:Infinite)?Query\(\s*(\[[^\]]+\]|['\"][^'\"]+['\"])",
    re.DOTALL,
)


def iter_component_files(components_root: Path) -> List[Path]:
    if not components_root.exists():
        return []
    files: List[Path] = []
    files.extend(components_root.rglob("*.tsx"))
    files.extend(components_root.rglob("*.ts"))
    return files


def iter_hook_files(hooks_root: Path) -> List[Path]:
    if not hooks_root.exists():
        return []
    files: List[Path] = []
    files.extend(hooks_root.rglob("*.tsx"))
    files.extend(hooks_root.rglob("*.ts"))
    return files


def parse_hook_exports(path: Path) -> Dict[str, Dict[str, Any]]:
    text = path.read_text(encoding="utf-8")
    exports: Dict[str, Dict[str, Any]] = {}
    for regex in (EXPORT_FUNC_RE, EXPORT_CONST_RE):
        for match in regex.finditer(text):
            name = match.group(1)
            start = match.start()
            line, column = offset_to_line_column(text, start)
            end_line, end_column = offset_to_line_column(text, match.end())
            exports[name] = {
                "line": line,
                "span": {
                    "start": {"line": line, "column": column},
                    "end": {"line": end_line, "column": end_column},
                },
                "signature": signature_from_line(text, start),
                "doc_summary": jsdoc_summary(text, start),
            }
    return exports


def parse_component_exports(path: Path) -> Dict[str, Dict[str, Any]]:
    text = path.read_text(encoding="utf-8")
    exports: Dict[str, Dict[str, Any]] = {}
    for regex in (COMPONENT_EXPORT_FUNC_RE, COMPONENT_EXPORT_CLASS_RE, COMPONENT_EXPORT_CONST_RE):
        for match in regex.finditer(text):
            name = match.group(1)
            start = match.start()
            line, column = offset_to_line_column(text, start)
            end_line, end_column = offset_to_line_column(text, match.end())
            exports[name] = {
                "line": line,
                "span": {
                    "start": {"line": line, "column": column},
                    "end": {"line": end_line, "column": end_column},
                },
                "signature": signature_from_line(text, start),
                "doc_summary": jsdoc_summary(text, start),
            }
    return exports


def primary_component_name(path: Path, exports: Dict[Path, Dict[str, Dict[str, Any]]]) -> Optional[str]:
    names = exports.get(path) or {}
    if names:
        return sorted(names.keys())[0]
    stem = path.stem
    if stem and stem[0].isupper():
        return stem
    return to_pascal_case(stem) if stem else None


def hook_node_id(path: Path, name: str) -> str:
    return f"hook:{path.as_posix()}::{name}"


def query_key_node_id(key: str) -> str:
    return f"query_key:{key}"


def type_node_id(path: Path, name: str) -> str:
    return f"type:{path.as_posix()}::{name}"


def extract_frontend_hooks(web_root: Path) -> Graph:
    graph = Graph(source="frontend")
    components_root = web_root / "components"
    hooks_root = web_root / "hooks"

    hook_files = iter_hook_files(hooks_root)
    hook_exports: Dict[Path, Dict[str, Dict[str, Any]]] = {
        path: parse_hook_exports(path) for path in hook_files
    }
    component_files = iter_component_files(components_root)
    component_exports: Dict[Path, Dict[str, Dict[str, Any]]] = {
        path: parse_component_exports(path) for path in component_files
    }

    for component_path in component_files:
        source_name = primary_component_name(component_path, component_exports)
        if not source_name:
            continue
        text = component_path.read_text(encoding="utf-8")
        imports = parse_imports(text)
        for names, module in imports:
            if not module.startswith("@/") and not module.startswith("."):
                continue
            resolved = resolve_module_path(web_root, component_path, module)
            if not resolved or hooks_root not in resolved.parents:
                continue
            for name in names:
                if not name.startswith("use"):
                    continue
                if resolved in hook_exports and name not in hook_exports[resolved]:
                    continue
                hook_id = hook_node_id(resolved, name)
                hook_meta = (hook_exports.get(resolved) or {}).get(name, {})
                graph.add_node(
                    hook_id,
                    "hook",
                    label=name,
                    file=resolved.as_posix(),
                    **build_common_metadata(
                        resolved,
                        symbol=name,
                        line=hook_meta.get("line"),
                        span=hook_meta.get("span"),
                        signature=hook_meta.get("signature"),
                        doc_summary=hook_meta.get("doc_summary"),
                    ),
                )
                component_id = f"component:{component_path.as_posix()}::{source_name}"
                component_meta = (component_exports.get(component_path) or {}).get(source_name, {})
                graph.add_node(
                    component_id,
                    "component",
                    label=source_name,
                    file=component_path.as_posix(),
                    **build_common_metadata(
                        component_path,
                        symbol=source_name,
                        line=component_meta.get("line"),
                        span=component_meta.get("span"),
                        signature=component_meta.get("signature"),
                        doc_summary=component_meta.get("doc_summary"),
                    ),
                )
                graph.add_edge(component_id, hook_id, "component_uses_hook")

    for hook_path in hook_files:
        exports = hook_exports.get(hook_path) or {}
        if not exports:
            continue
        text = hook_path.read_text(encoding="utf-8")
        keys = set(QUERY_KEY_PROP_RE.findall(text))
        keys.update(USE_QUERY_RE.findall(text))
        imports = parse_imports(text)
        type_imports = [(names, module) for names, module in imports if module.startswith("@/types")]

        for hook_name, hook_meta in exports.items():
            hook_id = hook_node_id(hook_path, hook_name)
            graph.add_node(
                hook_id,
                "hook",
                label=hook_name,
                file=hook_path.as_posix(),
                **build_common_metadata(
                    hook_path,
                    symbol=hook_name,
                    line=hook_meta.get("line"),
                    span=hook_meta.get("span"),
                    signature=hook_meta.get("signature"),
                    doc_summary=hook_meta.get("doc_summary"),
                ),
            )
            for raw_key in keys:
                normalized = normalize_literal(raw_key)
                query_id = query_key_node_id(normalized)
                graph.add_node(
                    query_id,
                    "query_key",
                    label=normalized,
                )
                graph.add_edge(hook_id, query_id, "hook_registers_query_key")
            for names, module in type_imports:
                type_path = resolve_module_path(web_root, hook_path, module)
                if not type_path:
                    continue
                for name in names:
                    type_id = type_node_id(type_path, name)
                    graph.add_node(
                        type_id,
                        "type",
                        label=name,
                        file=type_path.as_posix(),
                        **build_common_metadata(type_path, symbol=name),
                    )
                    graph.add_edge(hook_id, type_id, "uses_type")

    return graph


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract frontend hook usage graph.")
    parser.add_argument(
        "--web-root",
        default="skillmeat/web",
        help="Path to web root (default: skillmeat/web)",
    )
    parser.add_argument(
        "--out",
        default="docs/architecture/codebase-graph/codebase-graph.frontend.hooks.json",
        help="Output JSON path",
    )
    args = parser.parse_args()

    graph = extract_frontend_hooks(Path(args.web_root))
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    graph.write_json(args.out)


if __name__ == "__main__":
    main()
