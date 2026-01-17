from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Dict, List

try:
    from .graph import Graph
except ImportError:  # pragma: no cover - fallback for direct script execution
    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    from scripts.code_map.graph import Graph


def _load_graph(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _merge_nodes(
    primary: Dict[str, Dict[str, Any]],
    incoming: Dict[str, Dict[str, Any]],
) -> Dict[str, Dict[str, Any]]:
    merged = dict(primary)
    for node_id, node in incoming.items():
        if node_id not in merged:
            merged[node_id] = node
            continue
        existing = merged[node_id]
        for key, value in node.items():
            if key not in existing or existing[key] in (None, ""):
                existing[key] = value
    return merged


def _nodes_by_id(nodes: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    return {node["id"]: node for node in nodes}


def merge_graphs(frontend_path: Path, backend_path: Path) -> Graph:
    frontend = _load_graph(frontend_path)
    backend = _load_graph(backend_path)

    frontend_nodes = _nodes_by_id(frontend.get("nodes", []))
    backend_nodes = _nodes_by_id(backend.get("nodes", []))
    merged_nodes = _merge_nodes(frontend_nodes, backend_nodes)

    merged_edges = list(frontend.get("edges", []))
    merged_edges.extend(backend.get("edges", []))

    graph = Graph(source="unified")
    graph.nodes = merged_nodes
    graph.edges = merged_edges
    return graph


def main() -> None:
    parser = argparse.ArgumentParser(description="Merge frontend and backend graphs.")
    parser.add_argument(
        "--frontend",
        default="docs/architecture/codebase-graph/codebase-graph.frontend.json",
        help="Path to frontend graph JSON",
    )
    parser.add_argument(
        "--backend",
        default="docs/architecture/codebase-graph/codebase-graph.backend.json",
        help="Path to backend graph JSON",
    )
    parser.add_argument(
        "--out",
        default="docs/architecture/codebase-graph/codebase-graph.unified.json",
        help="Output unified graph JSON path",
    )
    args = parser.parse_args()

    graph = merge_graphs(Path(args.frontend), Path(args.backend))
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    graph.write_json(args.out)


if __name__ == "__main__":
    main()
