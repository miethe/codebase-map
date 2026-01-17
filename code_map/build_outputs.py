from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional


def _load_graph(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _load_details(path: Optional[Path]) -> Optional[Dict[str, Any]]:
    if not path or not path.exists():
        return None
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _node_index(nodes: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    return {node["id"]: node for node in nodes}


def _display_name(node: Dict[str, Any], details: Optional[Dict[str, Any]] = None) -> str:
    label = node.get("label")
    if label:
        name = str(label)
    else:
        node_id = node.get("id", "")
        if "::" in node_id:
            name = node_id.split("::")[-1]
        else:
            name = node_id
    title = _node_title(node.get("id"), details)
    if not title:
        return name
    return f'<span title="{title}">{name}</span>'


def _node_title(node_id: Optional[str], details: Optional[Dict[str, Any]]) -> Optional[str]:
    if not node_id or not details:
        return None
    info = (details.get("nodes") or {}).get(node_id)
    if not info:
        return None
    title = info.get("doc_summary") or info.get("docstring") or info.get("signature")
    if not title:
        return None
    title = " ".join(str(title).split())
    return title.replace('"', "&quot;")


def _update_section(path: Path, start: str, end: str, content: str) -> None:
    if not path.exists():
        raise FileNotFoundError(path)
    text = path.read_text(encoding="utf-8")
    if start not in text or end not in text:
        raise ValueError(f"Missing markers in {path}")
    before, remainder = text.split(start, 1)
    _, after = remainder.split(end, 1)
    updated = before + start + "\n" + content.rstrip() + "\n" + end + after
    path.write_text(updated, encoding="utf-8")


def _format_table(headers: List[str], rows: Iterable[List[str]]) -> str:
    lines = []
    lines.append("| " + " | ".join(headers) + " |")
    lines.append("| " + " | ".join(["---"] * len(headers)) + " |")
    for row in rows:
        lines.append("| " + " | ".join(row) + " |")
    return "\n".join(lines)


def _format_list(values: Iterable[str]) -> str:
    values = [value for value in values if value]
    if not values:
        return "-"
    return ", ".join(sorted(set(values)))


def build_hooks_table(
    nodes: List[Dict[str, Any]],
    edges: List[Dict[str, Any]],
    details: Optional[Dict[str, Any]] = None,
) -> str:
    node_index = _node_index(nodes)
    hook_nodes = [node for node in nodes if node.get("type") == "hook"]

    hook_clients: Dict[str, List[str]] = {}
    hook_queries: Dict[str, List[str]] = {}

    for edge in edges:
        if edge.get("type") == "hook_calls_api_client":
            hook_id = edge.get("from")
            client = node_index.get(edge.get("to"))
            if hook_id and client:
                hook_clients.setdefault(hook_id, []).append(_display_name(client, details))
        if edge.get("type") == "hook_registers_query_key":
            hook_id = edge.get("from")
            query = node_index.get(edge.get("to"))
            if hook_id and query:
                hook_queries.setdefault(hook_id, []).append(_display_name(query, details))

    rows: List[List[str]] = []
    for node in sorted(hook_nodes, key=lambda item: _display_name(item, details)):
        hook_id = node["id"]
        rows.append(
            [
                _display_name(node, details),
                node.get("file", "-"),
                _format_list(hook_clients.get(hook_id, [])),
                _format_list(hook_queries.get(hook_id, [])),
            ]
        )
    return _format_table(["Hook", "File", "API Clients", "Query Keys"], rows)


def build_api_clients_table(
    nodes: List[Dict[str, Any]],
    edges: List[Dict[str, Any]],
    details: Optional[Dict[str, Any]] = None,
) -> str:
    node_index = _node_index(nodes)
    client_nodes = [node for node in nodes if node.get("type") == "api_client"]

    client_endpoints: Dict[str, List[str]] = {}
    for edge in edges:
        if edge.get("type") != "api_client_calls_endpoint":
            continue
        client_id = edge.get("from")
        endpoint = node_index.get(edge.get("to"))
        if client_id and endpoint:
            client_endpoints.setdefault(client_id, []).append(_display_name(endpoint, details))

    rows: List[List[str]] = []
    for node in sorted(client_nodes, key=lambda item: _display_name(item, details)):
        client_id = node["id"]
        rows.append(
            [
                _display_name(node, details),
                node.get("file", "-"),
                _format_list(client_endpoints.get(client_id, [])),
            ]
        )
    return _format_table(["API Client", "File", "Endpoints"], rows)


def build_schemas_table(
    nodes: List[Dict[str, Any]],
    edges: List[Dict[str, Any]],
    details: Optional[Dict[str, Any]] = None,
) -> str:
    node_index = _node_index(nodes)
    schema_nodes = [node for node in nodes if node.get("type") == "schema"]

    schema_handlers: Dict[str, List[str]] = {}
    for edge in edges:
        if edge.get("type") != "handler_uses_schema":
            continue
        schema_id = edge.get("to")
        handler = node_index.get(edge.get("from"))
        if schema_id and handler:
            schema_handlers.setdefault(schema_id, []).append(_display_name(handler, details))

    rows: List[List[str]] = []
    for node in sorted(schema_nodes, key=lambda item: _display_name(item, details)):
        schema_id = node["id"]
        rows.append(
            [
                _display_name(node, details),
                node.get("file", "-"),
                _format_list(schema_handlers.get(schema_id, [])),
            ]
        )
    return _format_table(["Schema", "File", "Handlers"], rows)


def build_outputs(graph_path: Path, details_path: Optional[Path] = None) -> None:
    graph = _load_graph(graph_path)
    nodes = graph.get("nodes", [])
    edges = graph.get("edges", [])

    details = _load_details(details_path)
    hooks_table = build_hooks_table(nodes, edges, details)
    api_clients_table = build_api_clients_table(nodes, edges, details)
    schemas_table = build_schemas_table(nodes, edges, details)

    _ = hooks_table
    _ = api_clients_table
    _ = schemas_table


def main() -> None:
    parser = argparse.ArgumentParser(description="Build rule inventory outputs from the graph.")
    parser.add_argument(
        "--graph",
        default="docs/architecture/codebase-graph/codebase-graph.unified.json",
        help="Unified graph JSON path",
    )
    parser.add_argument(
        "--details",
        default="docs/architecture/codebase-graph/codebase-graph.details.json",
        help="Optional details JSON path",
    )
    args = parser.parse_args()

    build_outputs(Path(args.graph), Path(args.details))


if __name__ == "__main__":
    main()
