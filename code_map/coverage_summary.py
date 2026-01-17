from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any, Dict, List, Tuple


def _load_graph(path: Path) -> Dict[str, Any]:
    if not path.exists():
        print(f"ERROR: graph file not found: {path}")
        print("Build the unified graph first:")
        print("- python -m scripts.code_map.merge_graphs")
        print("- python -m scripts.code_map.apply_overrides")
        raise FileNotFoundError(path)
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _count_by_key(items: List[Dict[str, Any]], key: str) -> Counter:
    counter: Counter = Counter()
    for item in items:
        value = item.get(key, "<missing>")
        counter[value] += 1
    return counter


def _print_counter(title: str, counter: Counter) -> None:
    print(title)
    for item, count in counter.most_common():
        print(f"- {item}: {count}")
    print()


def _hook_api_buckets(
    nodes: List[Dict[str, Any]],
    edges: List[Dict[str, Any]],
) -> Dict[str, List[str]]:
    hook_ids = {node["id"] for node in nodes if node.get("type") == "hook"}
    calls_api = {edge["from"] for edge in edges if edge.get("type") == "calls_api"}
    calls_client = {
        edge["from"] for edge in edges if edge.get("type") == "hook_calls_api_client"
    }

    direct_only = sorted(calls_api - calls_client)
    client_only = sorted(calls_client - calls_api)
    both = sorted(calls_api & calls_client)
    without_api = sorted(hook_ids - calls_api - calls_client)

    return {
        "hooks_api_client_only": client_only,
        "hooks_direct_api_only": direct_only,
        "hooks_with_both": both,
        "hooks_without_api": without_api,
    }


def _print_bucket(label: str, items: List[str], max_list: int) -> None:
    print(f"- {label}: {len(items)}")
    if items and max_list > 0:
        print("  - sample:")
        for item in items[:max_list]:
            print(f"    - {item}")


def _missing_edge_bucket(
    nodes: List[Dict[str, Any]],
    edges: List[Dict[str, Any]],
    node_type: str,
    edge_type: str,
) -> List[str]:
    node_ids = {node["id"] for node in nodes if node.get("type") == node_type}
    linked = {edge.get("from") for edge in edges if edge.get("type") == edge_type}
    return sorted(node_ids - linked)


def coverage_summary(graph: Dict[str, Any], max_list: int) -> None:
    nodes = graph.get("nodes", [])
    edges = graph.get("edges", [])

    _print_counter("Node counts by type:", _count_by_key(nodes, "type"))
    _print_counter("Edge counts by type:", _count_by_key(edges, "type"))

    buckets = _hook_api_buckets(nodes, edges)
    print("Hook API coverage:")
    _print_bucket("hooks_api_client_only", buckets["hooks_api_client_only"], max_list)
    _print_bucket("hooks_direct_api_only", buckets["hooks_direct_api_only"], max_list)
    _print_bucket("hooks_with_both", buckets["hooks_with_both"], max_list)
    _print_bucket("hooks_without_api", buckets["hooks_without_api"], max_list)

    missing_handlers = _missing_edge_bucket(nodes, edges, "handler", "handler_uses_schema")
    missing_services = _missing_edge_bucket(nodes, edges, "service", "service_calls_repository")
    missing_models = _missing_edge_bucket(nodes, edges, "model", "model_migrated_by")
    print("Missing linkage coverage:")
    _print_bucket("handlers_without_schema", missing_handlers, max_list)
    _print_bucket("services_without_repo", missing_services, max_list)
    _print_bucket("models_without_migration", missing_models, max_list)


def main() -> None:
    parser = argparse.ArgumentParser(description="Summarize graph coverage.")
    parser.add_argument(
        "--graph",
        default="docs/architecture/codebase-graph/codebase-graph.unified.json",
        help="Unified graph JSON path",
    )
    parser.add_argument(
        "--max-list",
        type=int,
        default=20,
        help="Max number of missing items to list",
    )
    args = parser.parse_args()

    try:
        graph = _load_graph(Path(args.graph))
    except FileNotFoundError:
        sys.exit(1)
    coverage_summary(graph, args.max_list)


if __name__ == "__main__":
    main()
