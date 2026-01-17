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


def _guess_prefix(graph_path: Path) -> str:
    name = graph_path.name
    if name.endswith(".unified.json"):
        return name[: -len(".unified.json")]
    if name.endswith(".json"):
        return name[: -len(".json")]
    return name


def _find_cluster_id(cluster_path: Optional[List[str]], prefix: str) -> Optional[str]:
    if not cluster_path:
        return None
    for item in cluster_path:
        if item.startswith(prefix):
            return item
    return None


def _cluster_id_for_lod(node: Dict[str, Any], lod: int) -> Optional[str]:
    cluster_path = node.get("cluster_path")
    if lod == 0:
        return _find_cluster_id(cluster_path, "package:") or _find_cluster_id(cluster_path, "repo:")
    if lod == 1:
        return (
            _find_cluster_id(cluster_path, "module:")
            or _find_cluster_id(cluster_path, "folder:")
            or _find_cluster_id(cluster_path, "package:")
        )
    if lod == 2:
        return (
            _find_cluster_id(cluster_path, "file:")
            or _find_cluster_id(cluster_path, "folder:")
            or _find_cluster_id(cluster_path, "module:")
            or _find_cluster_id(cluster_path, "package:")
        )
    if lod == 3:
        return node.get("cluster_id") or f"symbol:{node.get('id')}"
    return None


def _cluster_label(cluster_id: str) -> str:
    if ":" not in cluster_id:
        return cluster_id
    return cluster_id.split(":", 1)[-1]


def _cluster_type(lod: int) -> str:
    return {0: "package", 1: "module", 2: "file", 3: "symbol"}.get(lod, "cluster")


def _aggregate_lod_graph(
    nodes: List[Dict[str, Any]],
    edges: List[Dict[str, Any]],
    lod: int,
    base_metadata: Dict[str, Any],
) -> Dict[str, Any]:
    if lod == 3:
        return {
            **base_metadata,
            "source": f"lod{lod}",
            "nodes": nodes,
            "edges": edges,
        }

    cluster_nodes: Dict[str, Dict[str, Any]] = {}
    node_to_cluster: Dict[str, str] = {}

    for node in nodes:
        node_id = node.get("id")
        if not node_id:
            continue
        cluster_id = _cluster_id_for_lod(node, lod)
        if not cluster_id:
            continue
        node_to_cluster[node_id] = cluster_id
        cluster = cluster_nodes.get(cluster_id)
        if not cluster:
            cluster = {
                "id": cluster_id,
                "type": _cluster_type(lod),
                "kind": "cluster",
                "label": _cluster_label(cluster_id),
                "label_short": _cluster_label(cluster_id).split("/")[-1],
                "size": 0,
                "member_count": 0,
                "member_layers": {},
                "cluster_id": cluster_id,
            }
            cluster_path = node.get("cluster_path") or []
            if cluster_id in cluster_path:
                idx = cluster_path.index(cluster_id)
                cluster["cluster_path"] = cluster_path[: idx + 1]
            cluster_nodes[cluster_id] = cluster
        cluster["member_count"] += 1
        cluster["size"] += node.get("size") or 0
        layer = node.get("layer") or "unknown"
        cluster["member_layers"][layer] = cluster["member_layers"].get(layer, 0) + 1

    for cluster_id, cluster in cluster_nodes.items():
        layer_counts = cluster.get("member_layers") or {}
        if layer_counts:
            dominant_layer = max(layer_counts.items(), key=lambda item: item[1])[0]
            cluster["layer"] = dominant_layer
        cluster.pop("member_layers", None)

    aggregated_edges: Dict[tuple[str, str, str], Dict[str, Any]] = {}
    for edge in edges:
        source = edge.get("from")
        target = edge.get("to")
        if not source or not target:
            continue
        source_cluster = node_to_cluster.get(source)
        target_cluster = node_to_cluster.get(target)
        if not source_cluster or not target_cluster:
            continue
        if source_cluster == target_cluster:
            continue
        edge_type = edge.get("type") or "default"
        key = (source_cluster, target_cluster, edge_type)
        agg = aggregated_edges.get(key)
        if not agg:
            agg = {
                "from": source_cluster,
                "to": target_cluster,
                "type": edge_type,
                "weight": 0,
                "confidence": edge.get("confidence") or "static",
            }
            aggregated_edges[key] = agg
        agg["weight"] += edge.get("weight") or 1

    return {
        **base_metadata,
        "source": f"lod{lod}",
        "nodes": list(cluster_nodes.values()),
        "edges": list(aggregated_edges.values()),
    }


def build_lod_graphs(
    graph: Dict[str, Any],
    out_dir: Path,
    prefix: str,
) -> None:
    nodes = graph.get("nodes", []) or []
    edges = graph.get("edges", []) or []
    base_metadata = {
        "schema_version": graph.get("schema_version"),
        "generated_at": graph.get("generated_at"),
        "source_commit": graph.get("source_commit"),
    }
    for lod in range(4):
        payload = _aggregate_lod_graph(nodes, edges, lod, base_metadata)
        out_path = out_dir / f"{prefix}.lod{lod}.json"
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with out_path.open("w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, sort_keys=True)
            handle.write("\n")


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


def build_outputs(
    graph_path: Path,
    details_path: Optional[Path] = None,
    lod_out_dir: Optional[Path] = None,
) -> None:
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

    prefix = _guess_prefix(graph_path)
    out_dir = lod_out_dir or graph_path.parent
    build_lod_graphs(graph, out_dir, prefix)


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
    parser.add_argument(
        "--lod-out-dir",
        default=None,
        help="Directory for LOD output JSON files (defaults to graph directory)",
    )
    args = parser.parse_args()

    lod_out = Path(args.lod_out_dir) if args.lod_out_dir else None
    build_outputs(Path(args.graph), Path(args.details), lod_out)


if __name__ == "__main__":
    main()
