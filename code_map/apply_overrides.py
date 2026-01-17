from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml


def _load_json(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _write_json(path: Path, payload: Dict[str, Any]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=True)
        handle.write("\n")


def _edge_key(edge: Dict[str, Any]) -> Optional[str]:
    edge_id = edge.get("id")
    if edge_id:
        return edge_id
    edge_from = edge.get("from")
    edge_to = edge.get("to")
    edge_type = edge.get("type")
    if edge_from and edge_to and edge_type:
        return f"{edge_from}->{edge_to}:{edge_type}"
    return None


def _override_node(node: Dict[str, Any], override: Dict[str, Any]) -> None:
    for key, value in override.items():
        if key == "id":
            continue
        if value is not None:
            node[key] = value


def _override_edge(edge: Dict[str, Any], override: Dict[str, Any]) -> None:
    for key, value in override.items():
        if key in {"id", "from", "to", "type"}:
            continue
        if value is not None:
            edge[key] = value


def apply_overrides(graph: Dict[str, Any], overrides: Dict[str, Any]) -> None:
    nodes = graph.get("nodes", [])
    edges = graph.get("edges", [])

    node_index = {node.get("id"): node for node in nodes}
    edge_index = {}
    edge_index_by_pair: Dict[str, List[Dict[str, Any]]] = {}
    for edge in edges:
        key = _edge_key(edge)
        if key:
            edge_index[key] = edge
        edge_from = edge.get("from")
        edge_to = edge.get("to")
        if edge_from and edge_to:
            pair_key = f"{edge_from}->{edge_to}"
            edge_index_by_pair.setdefault(pair_key, []).append(edge)

    for override in overrides.get("nodes", []) or []:
        node_id = override.get("id")
        if not node_id:
            continue
        node = node_index.get(node_id)
        if not node:
            print(f"WARN: node override not found: {node_id}")
            continue
        _override_node(node, override)

    for override in overrides.get("edges", []) or []:
        edge_id = override.get("id")
        if edge_id:
            edge = edge_index.get(edge_id)
        else:
            edge_key = None
            edge = None
            edge_from = override.get("from")
            edge_to = override.get("to")
            edge_type = override.get("type")
            if edge_from and edge_to and edge_type:
                edge_key = f"{edge_from}->{edge_to}:{edge_type}"
                edge = edge_index.get(edge_key)
            elif edge_from and edge_to:
                pair_key = f"{edge_from}->{edge_to}"
                matches = edge_index_by_pair.get(pair_key, [])
                if len(matches) > 1:
                    print(f"WARN: multiple edge matches for {pair_key}, using first")
                edge = matches[0] if matches else None
        if not edge:
            display_key = edge_id or edge_key or "<unknown>"
            print(f"WARN: edge override not found: {display_key}")
            continue
        _override_edge(edge, override)


def main() -> None:
    parser = argparse.ArgumentParser(description="Apply metadata overrides to a graph.")
    parser.add_argument(
        "--in",
        dest="in_path",
        default="docs/architecture/codebase-graph/codebase-graph.unified.json",
        help="Input unified graph JSON path",
    )
    parser.add_argument(
        "--overrides",
        default="docs/architecture/codebase-graph/codebase-graph.overrides.yaml",
        help="Overrides YAML path",
    )
    parser.add_argument(
        "--out",
        default="docs/architecture/codebase-graph/codebase-graph.unified.json",
        help="Output graph JSON path",
    )
    args = parser.parse_args()

    graph_path = Path(args.in_path)
    overrides_path = Path(args.overrides)
    graph = _load_json(graph_path)

    with overrides_path.open("r", encoding="utf-8") as handle:
        overrides = yaml.safe_load(handle) or {}

    apply_overrides(graph, overrides)
    _write_json(Path(args.out), graph)


if __name__ == "__main__":
    main()
