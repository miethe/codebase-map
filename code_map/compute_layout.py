from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Tuple

try:
    import networkx as nx
except ImportError:
    nx = None  # type: ignore


def compute_layout(
    nodes: List[Dict[str, Any]],
    edges: List[Dict[str, Any]],
    iterations: int = 50,
    scale: float = 2000.0,
) -> Dict[str, Tuple[float, float, float]]:
    """
    Compute a 2D spring layout for the given graph.
    Returns a dictionary mapping node_id -> (x, y, z).
    z is always 0 for 2D layouts.
    """
    if not nx:
        return {}

    G = nx.Graph()
    
    # Add nodes
    # Use degree or size as weight hint if possible, but basic spring is fine
    for node in nodes:
        G.add_node(node["id"])

    # Add edges with weights
    for edge in edges:
        u = edge.get("from")
        v = edge.get("to")
        if u and v and u in G and v in G:
            weight = edge.get("weight") or 1.0
            # Higher weight = stronger attraction = closer
            G.add_edge(u, v, weight=weight)

    # Compute layout
    # k is optimal distance between nodes. Increase to spread out.
    # iterations: higher = more stable but slower
    k_val = 1.0 / math.sqrt(len(nodes)) if nodes else 1.0
    # Boost k for better separation
    k_val *= 2.5
    
    pos = nx.spring_layout(
        G,
        dim=2,
        k=k_val,
        iterations=iterations,
        scale=scale,
        seed=42,  # Deterministic
    )

    # Format output
    result = {}
    for node_id, (x, y) in pos.items():
        result[node_id] = (float(x), float(y), 0.0)

    return result
