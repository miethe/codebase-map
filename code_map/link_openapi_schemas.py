from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional


def _load_json(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _write_json(path: Path, payload: Dict[str, Any]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=True)
        handle.write("\n")


def _schema_name(node: Dict[str, Any]) -> Optional[str]:
    label = node.get("label")
    if label:
        return str(label)
    node_id = node.get("id", "")
    if "::" in node_id:
        return node_id.split("::")[-1]
    return None


def _prefer_schema_nodes(nodes: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    preferred = [
        node for node in nodes if "skillmeat/api/schemas" in (node.get("file") or "")
    ]
    return preferred or nodes


def _edge_key(edge: Dict[str, Any]) -> str:
    role = edge.get("role")
    if role:
        return f"{edge.get('from')}->{edge.get('to')}:{edge.get('type')}:{role}"
    return f"{edge.get('from')}->{edge.get('to')}:{edge.get('type')}"


def link_openapi_schemas(graph: Dict[str, Any]) -> None:
    nodes = graph.get("nodes", []) or []
    edges = graph.get("edges", []) or []
    schema_nodes = [node for node in nodes if node.get("type") == "schema"]

    by_name: Dict[str, List[Dict[str, Any]]] = {}
    for node in schema_nodes:
        name = _schema_name(node)
        if not name:
            continue
        by_name.setdefault(name, []).append(node)

    edge_index = {_edge_key(edge) for edge in edges}
    for node in nodes:
        if node.get("type") != "api_endpoint":
            continue
        endpoint_id = node.get("id")
        if not endpoint_id:
            continue
        for role_key, role in (("request_schema", "request"), ("response_schema", "response")):
            schema_name = node.get(role_key)
            if not schema_name:
                continue
            candidates = by_name.get(str(schema_name), [])
            if not candidates:
                continue
            for schema_node in _prefer_schema_nodes(candidates):
                edge = {
                    "from": endpoint_id,
                    "to": schema_node["id"],
                    "type": "api_endpoint_uses_schema",
                    "role": role,
                    "source": "openapi",
                }
                key = _edge_key(edge)
                if key in edge_index:
                    continue
                edges.append(edge)
                edge_index.add(key)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Link OpenAPI request/response schemas to schema nodes."
    )
    parser.add_argument(
        "--graph",
        default="docs/architecture/codebase-graph/codebase-graph.unified.json",
        help="Unified graph JSON path",
    )
    parser.add_argument(
        "--out",
        default="docs/architecture/codebase-graph/codebase-graph.unified.json",
        help="Output graph JSON path",
    )
    args = parser.parse_args()

    graph_path = Path(args.graph)
    graph = _load_json(graph_path)
    link_openapi_schemas(graph)
    _write_json(Path(args.out), graph)


if __name__ == "__main__":
    main()
