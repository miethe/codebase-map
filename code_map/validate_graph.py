from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Set


def _load_graph(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _node_index(nodes: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    return {node["id"]: node for node in nodes}


def validate_graph(graph: Dict[str, Any]) -> List[str]:
    errors: List[str] = []
    nodes = graph.get("nodes", [])
    edges = graph.get("edges", [])

    node_index = _node_index(nodes)
    node_ids = set(node_index.keys())

    incoming: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for edge in edges:
        incoming[edge.get("to")].append(edge)

    for edge in edges:
        if edge.get("type") in {"calls_api", "api_client_calls_endpoint"}:
            target = edge.get("to")
            if target not in node_ids:
                errors.append(f"missing_endpoint:{target}")

    for node_id, node in node_index.items():
        if node.get("deprecated") is True:
            in_edges = incoming.get(node_id, [])
            for edge in in_edges:
                if edge.get("allow_deprecated"):
                    continue
                errors.append(f"deprecated_in_use:{node_id}")
                break

    for node in nodes:
        if node.get("type") != "api_endpoint":
            continue
        if not (node.get("openapi") or (node.get("file") or "").endswith("openapi.json")):
            continue
        endpoint_id = node["id"]
        has_handler = any(
            edge.get("from") == endpoint_id and edge.get("type") == "handled_by" for edge in edges
        )
        if not has_handler:
            errors.append(f"openapi_endpoint_missing_handler:{endpoint_id}")

    handled_endpoints = {
        edge.get("from")
        for edge in edges
        if edge.get("type") == "handled_by" and edge.get("from")
    }
    for endpoint_id in handled_endpoints:
        node = node_index.get(endpoint_id)
        if not node or node.get("type") != "api_endpoint":
            continue
        if not node.get("openapi"):
            errors.append(f"endpoint_missing_openapi:{endpoint_id}")

    for edge in edges:
        if edge.get("type") != "handler_uses_schema":
            continue
        if not edge.get("role"):
            errors.append(f"schema_edge_missing_role:{edge.get('from')}->{edge.get('to')}")

    for node in nodes:
        if node.get("type") != "page":
            continue
        if node.get("ignore") or node.get("ignore_component_check"):
            continue
        page_id = node["id"]
        has_component = any(
            edge.get("from") == page_id and edge.get("type") == "page_uses_component"
            for edge in edges
        )
        if not has_component:
            errors.append(f"page_missing_component:{page_id}")

    return errors


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate the unified graph.")
    parser.add_argument(
        "--graph",
        default="docs/architecture/codebase-graph/codebase-graph.unified.json",
        help="Unified graph JSON path",
    )
    args = parser.parse_args()

    graph_path = Path(args.graph)
    if not graph_path.exists():
        print(f"ERROR: graph file not found: {graph_path}")
        sys.exit(1)

    graph = _load_graph(graph_path)
    errors = validate_graph(graph)
    if errors:
        print("Validation failures:")
        for error in errors:
            print(f"- {error}")
        sys.exit(1)

    print("Graph validation passed.")


if __name__ == "__main__":
    main()
