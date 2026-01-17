from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

from .metadata_utils import parse_semantic_tags


def _load_json(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _write_json(path: Path, payload: Dict[str, Any]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=True)
        handle.write("\n")


def _ensure_list(value: Any) -> List[str]:
    if not value:
        return []
    if isinstance(value, list):
        return [str(item) for item in value if str(item)]
    return [str(value)]


def _merge_list_field(node: Dict[str, Any], key: str, values: Iterable[str]) -> None:
    existing = _ensure_list(node.get(key))
    merged = list(dict.fromkeys(existing + [str(v) for v in values if str(v)]))
    if merged:
        node[key] = merged


def apply_semantic_tags(graph: Dict[str, Any], details: Dict[str, Any]) -> None:
    detail_nodes = details.get("nodes", {}) if details else {}
    for node in graph.get("nodes", []) or []:
        node_id = node.get("id")
        if not node_id:
            continue
        detail = detail_nodes.get(node_id, {})
        docstring = detail.get("docstring") or detail.get("doc_summary")
        tags = parse_semantic_tags(docstring)
        if not tags:
            continue
        _merge_list_field(node, "domains", tags.get("domains", []))
        _merge_list_field(node, "module_tags", tags.get("modules", []))
        if node.get("domains") and not node.get("domain"):
            node["domain"] = node["domains"][0]
        if node.get("module_tags") and not node.get("module_tag"):
            node["module_tag"] = node["module_tags"][0]


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Apply semantic @domain/@module tags from details docstrings to the graph."
    )
    parser.add_argument(
        "--graph",
        default="docs/architecture/codebase-graph/codebase-graph.unified.json",
        help="Unified graph JSON path",
    )
    parser.add_argument(
        "--details",
        default="docs/architecture/codebase-graph/codebase-graph.details.json",
        help="Details JSON path",
    )
    parser.add_argument(
        "--out",
        default="docs/architecture/codebase-graph/codebase-graph.unified.json",
        help="Output graph JSON path",
    )
    args = parser.parse_args()

    graph_path = Path(args.graph)
    details_path = Path(args.details)
    graph = _load_json(graph_path)
    details = _load_json(details_path) if details_path.exists() else {}

    apply_semantic_tags(graph, details)
    _write_json(Path(args.out), graph)


if __name__ == "__main__":
    main()
