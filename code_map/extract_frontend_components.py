from __future__ import annotations

import argparse
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

try:
    from .graph import Graph
    from .frontend_utils import (
        is_component_name,
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
        is_component_name,
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

EXPORT_FUNC_RE = re.compile(r"export\s+(?:async\s+)?function\s+([A-Z][A-Za-z0-9_]*)")
EXPORT_CLASS_RE = re.compile(r"export\s+class\s+([A-Z][A-Za-z0-9_]*)")
EXPORT_CONST_RE = re.compile(r"export\s+const\s+([A-Z][A-Za-z0-9_]*)\b")


def iter_page_files(app_root: Path) -> List[Path]:
    if not app_root.exists():
        return []
    return list(app_root.rglob("page.tsx"))


def iter_component_files(components_root: Path) -> List[Path]:
    if not components_root.exists():
        return []
    files: List[Path] = []
    files.extend(components_root.rglob("*.tsx"))
    files.extend(components_root.rglob("*.ts"))
    return files


def parse_component_exports(path: Path) -> Dict[str, Dict[str, Any]]:
    text = path.read_text(encoding="utf-8")
    exports: Dict[str, Dict[str, Any]] = {}
    for regex in (EXPORT_FUNC_RE, EXPORT_CLASS_RE, EXPORT_CONST_RE):
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
    if stem and is_component_name(stem):
        return stem
    return to_pascal_case(stem) if stem else None


def component_node_id(path: Path, name: str) -> str:
    return f"component:{path.as_posix()}::{name}"


def type_node_id(path: Path, name: str) -> str:
    return f"type:{path.as_posix()}::{name}"


def extract_frontend_components(web_root: Path) -> Graph:
    graph = Graph(source="frontend")
    app_root = web_root / "app"
    components_root = web_root / "components"

    component_files = iter_component_files(components_root)
    exports: Dict[Path, Dict[str, Dict[str, Any]]] = {
        path: parse_component_exports(path) for path in component_files
    }

    for path, names in exports.items():
        for name, meta in names.items():
            graph.add_node(
                component_node_id(path, name),
                "component",
                label=name,
                file=path.as_posix(),
                **build_common_metadata(
                    path,
                    symbol=name,
                    line=meta.get("line"),
                    span=meta.get("span"),
                    signature=meta.get("signature"),
                    doc_summary=meta.get("doc_summary"),
                ),
            )

    for page_path in iter_page_files(app_root):
        page_id = f"page:{page_path.as_posix()}"
        graph.add_node(
            page_id,
            "page",
            file=page_path.as_posix(),
            **build_common_metadata(page_path),
        )
        text = page_path.read_text(encoding="utf-8")
        for names, module in parse_imports(text):
            target_path = resolve_module_path(web_root, page_path, module)
            if not target_path:
                continue
            for name in names:
                if not is_component_name(name):
                    continue
                target_id = component_node_id(target_path, name)
                target_meta = (exports.get(target_path) or {}).get(name, {})
                graph.add_node(
                    target_id,
                    "component",
                    label=name,
                    file=target_path.as_posix(),
                    **build_common_metadata(
                        target_path,
                        symbol=name,
                        line=target_meta.get("line"),
                        span=target_meta.get("span"),
                        signature=target_meta.get("signature"),
                        doc_summary=target_meta.get("doc_summary"),
                    ),
                )
                graph.add_edge(page_id, target_id, "page_uses_component")

    for component_path in component_files:
        source_name = primary_component_name(component_path, exports)
        if not source_name:
            continue
        source_id = component_node_id(component_path, source_name)
        source_meta = (exports.get(component_path) or {}).get(source_name, {})
        graph.add_node(
            source_id,
            "component",
            label=source_name,
            file=component_path.as_posix(),
            **build_common_metadata(
                component_path,
                symbol=source_name,
                line=source_meta.get("line"),
                span=source_meta.get("span"),
                signature=source_meta.get("signature"),
                doc_summary=source_meta.get("doc_summary"),
            ),
        )
        text = component_path.read_text(encoding="utf-8")
        for names, module in parse_imports(text):
            if module.startswith("@/types"):
                type_path = resolve_module_path(web_root, component_path, module)
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
                    graph.add_edge(source_id, type_id, "uses_type")
                continue
            target_path = resolve_module_path(web_root, component_path, module)
            if not target_path:
                continue
            for name in names:
                if not is_component_name(name):
                    continue
                target_id = component_node_id(target_path, name)
                target_meta = (exports.get(target_path) or {}).get(name, {})
                graph.add_node(
                    target_id,
                    "component",
                    label=name,
                    file=target_path.as_posix(),
                    **build_common_metadata(
                        target_path,
                        symbol=name,
                        line=target_meta.get("line"),
                        span=target_meta.get("span"),
                        signature=target_meta.get("signature"),
                        doc_summary=target_meta.get("doc_summary"),
                    ),
                )
                graph.add_edge(source_id, target_id, "component_uses_component")

    return graph


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract frontend component graph.")
    parser.add_argument(
        "--web-root",
        default="skillmeat/web",
        help="Path to web root (default: skillmeat/web)",
    )
    parser.add_argument(
        "--out",
        default="docs/architecture/codebase-graph/codebase-graph.frontend.components.json",
        help="Output JSON path",
    )
    args = parser.parse_args()

    graph = extract_frontend_components(Path(args.web_root))
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    graph.write_json(args.out)


if __name__ == "__main__":
    main()
