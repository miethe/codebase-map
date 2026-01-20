from __future__ import annotations

from typing import Any, Dict, List

try:
    import networkx as nx
except ImportError:
    nx = None  # type: ignore


def compute_metrics(
    nodes: List[Dict[str, Any]],
    edges: List[Dict[str, Any]],
) -> Dict[str, Dict[str, Any]]:
    """
    Compute structural metrics for the graph.
    Returns a dictionary mapping node_id -> {metric: value}.
    Metrics:
      - pagerank
      - degree_centrality
      - community (louvain) - represented as group id
    """
    if not nx:
        return {}

    G = nx.Graph()
    for node in nodes:
        G.add_node(node["id"])
    
    for edge in edges:
        u = edge.get("from")
        v = edge.get("to")
        if u and v and u in G and v in G:
            weight = edge.get("weight") or 1.0
            G.add_edge(u, v, weight=weight)

    metrics: Dict[str, Dict[str, Any]] = {n: {} for n in G.nodes}

    # 1. PageRank
    try:
        pr = nx.pagerank(G, weight="weight")
        for n, score in pr.items():
            metrics[n]["pagerank"] = score
    except Exception:
        pass

    # 2. Degree Centrality
    try:
        dc = nx.degree_centrality(G)
        for n, score in dc.items():
            metrics[n]["degree_centrality"] = score
    except Exception:
        pass

    # 3. Community Detection (Louvain)
    # NetworkX has built-in community.louvain_communities (requires nx >= 2.7)
    try:
        communities = nx.community.louvain_communities(G, weight="weight", seed=42)
        for i, comm in enumerate(communities):
            for n in comm:
                metrics[n]["community"] = i
    except Exception:
        pass
    
    # 4. Betweenness Centrality (expensive, maybe skip or approximation)
    # Using tiny sample for speed or skipping entirely for large graphs
    # Skip for now to keep build fast.

    return metrics
