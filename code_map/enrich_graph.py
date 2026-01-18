from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

REPO_ROOT = Path(__file__).resolve().parents[2]

LAYER_BY_TYPE = {
    "route": "ui",
    "page": "ui",
    "component": "ui",
    "hook": "ui",
    "api_client": "api",
    "api_endpoint": "api",
    "endpoint": "api",
    "router": "api",
    "handler": "api",
    "service": "domain",
    "model": "domain",
    "repository": "data",
    "schema": "data",
    "migration": "data",
    "type": "shared",
    "query_key": "shared",
    "external_dependency": "external",
}

ENTRYPOINT_FILES = {
    "index.tsx",
    "index.ts",
    "index.js",
    "index.jsx",
    "main.tsx",
    "main.ts",
    "main.js",
    "main.py",
    "app.tsx",
    "app.ts",
    "app.js",
    "app.py",
    "__main__.py",
    "server.ts",
    "server.js",
    "server.py",
    "vite.config.ts",
    "vite.config.js",
    "webpack.config.js",
    "next.config.js",
}

GENERATED_HINTS = (
    "/generated/",
    "/dist/",
    "/build/",
    "/.next/",
    "/coverage/",
)


def _utc_now_iso() -> str:
    return (
        datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def _load_json(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _write_json(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=True)
        handle.write("\n")


def _rel_path(path_value: Optional[str]) -> Optional[str]:
    if not path_value:
        return None
    path = Path(path_value)
    try:
        rel = path.resolve().relative_to(REPO_ROOT)
    except Exception:
        rel = path
    return rel.as_posix()


def _package_from_parts(parts: List[str]) -> Optional[str]:
    if not parts:
        return None
    if parts[0] in {"packages", "apps", "services", "libs", "modules"} and len(parts) > 1:
        return f"{parts[0]}/{parts[1]}"
    if parts[0] in {"src", "lib"}:
        return parts[0]
    if len(parts) > 1:
        return parts[0]
    return None


def _module_from_dir_parts(parts: List[str]) -> Optional[str]:
    if not parts:
        return None
    if len(parts) >= 2:
        return "/".join(parts[:2])
    return parts[0]


def _dedupe_consecutive(values: List[str]) -> List[str]:
    deduped: List[str] = []
    for value in values:
        if not value:
            continue
        if deduped and deduped[-1] == value:
            continue
        deduped.append(value)
    return deduped


def _infer_kind(node: Dict[str, Any]) -> str:
    if node.get("kind"):
        return str(node["kind"])
    if node.get("type") == "cluster":
        return "cluster"
    if node.get("symbol"):
        return "symbol"
    if node.get("file"):
        return "file"
    return "symbol"


def _infer_layer(node: Dict[str, Any]) -> Optional[str]:
    if node.get("layer"):
        return str(node["layer"])
    node_type = node.get("type")
    file_path = _rel_path(node.get("file")) or ""
    lowered = file_path.lower()

    if "node_modules" in lowered or "/vendor/" in lowered or "/third_party/" in lowered:
        return "external"
    if "/tests/" in lowered or "/__tests__/" in lowered or ".spec." in lowered or ".test." in lowered:
        return "tests"
    if "/infra/" in lowered or "/infrastructure/" in lowered or "/ops/" in lowered or "/deploy/" in lowered:
        return "infra"
    if "/data/" in lowered or "/db/" in lowered:
        return "data"
    if "/domain/" in lowered or "/core/" in lowered:
        return "domain"
    if "/api/" in lowered or "/routes/" in lowered:
        return "api"
    if "/ui/" in lowered or "/components/" in lowered or "/app/" in lowered or "/pages/" in lowered:
        return "ui"
    if "/shared/" in lowered or "/common/" in lowered or "/utils/" in lowered:
        return "shared"

    if node_type in LAYER_BY_TYPE:
        return LAYER_BY_TYPE[node_type]
    return "shared"


def _infer_externality(node: Dict[str, Any]) -> Optional[str]:
    if node.get("externality"):
        return str(node["externality"])
    if node.get("type") == "external_dependency":
        return "third_party"
    file_path = (_rel_path(node.get("file")) or "").lower()
    if "node_modules" in file_path or "/vendor/" in file_path:
        return "vendor"
    if "/third_party/" in file_path:
        return "third_party"
    return "internal"


def _infer_generated(node: Dict[str, Any]) -> Optional[bool]:
    if node.get("generated") is not None:
        return bool(node["generated"])
    file_path = (_rel_path(node.get("file")) or "").lower()
    if any(hint in file_path for hint in GENERATED_HINTS):
        return True
    if re.search(r"\.gen(erated)?\.", file_path):
        return True
    return False


def _infer_entrypoint(node: Dict[str, Any]) -> Optional[bool]:
    if node.get("entrypoint") is not None:
        return bool(node["entrypoint"])
    file_path = node.get("file")
    if not file_path:
        return None
    name = Path(file_path).name
    if name in ENTRYPOINT_FILES:
        return True
    return False


def _short_label(node: Dict[str, Any]) -> Optional[str]:
    if node.get("label_short"):
        return str(node["label_short"])
    label = node.get("label") or node.get("id") or ""
    if node.get("file"):
        name = Path(str(node["file"])).name
        label = re.sub(r"\.[^.]+$", "", name)
    if "::" in label:
        label = label.split("::")[-1]
    if ":" in label:
        label = label.split(":")[-1]
    label = label.strip()
    if len(label) > 40:
        label = label[-40:]
    return label or None


def _file_line_count(path_value: Optional[str], cache: Dict[str, Optional[int]]) -> Optional[int]:
    if not path_value:
        return None
    if path_value in cache:
        return cache[path_value]
    path = Path(path_value)
    if not path.exists():
        cache[path_value] = None
        return None
    try:
        with path.open("r", encoding="utf-8", errors="ignore") as handle:
            count = sum(1 for _ in handle)
    except Exception:
        count = None
    cache[path_value] = count
    return count


def _cluster_path(node: Dict[str, Any]) -> Tuple[Optional[str], Optional[List[str]]]:
    repo_id = f"repo:{REPO_ROOT.name}"
    rel_path = _rel_path(node.get("file"))
    parts = rel_path.split("/") if rel_path else []
    dir_parts = parts[:-1] if parts else []

    package = node.get("package") or _package_from_parts(parts)
    if not package and not parts:
        node_type = node.get("type") or "unknown"
        package = f"virtual/{node_type}"
    module = _module_from_dir_parts(dir_parts)
    folder = "/".join(dir_parts) if dir_parts else None
    file_id = rel_path if rel_path else None

    path: List[str] = [repo_id]
    if package:
        path.append(f"package:{package}")
    if module:
        path.append(f"module:{module}")
    if folder and (not module or folder != module):
        path.append(f"folder:{folder}")
    if file_id:
        path.append(f"file:{file_id}")

    node_kind = _infer_kind(node)
    if node_kind == "symbol":
        path.append(f"symbol:{node['id']}")

    path = _dedupe_consecutive(path)
    cluster_id = path[-1] if path else None
    return cluster_id, path or None


def _find_cluster_id(cluster_path: Optional[List[str]], prefix: str) -> Optional[str]:
    if not cluster_path:
        return None
    for item in cluster_path:
        if item.startswith(prefix):
            return item
    return None


def _distance_class(
    source: Optional[Dict[str, Any]],
    target: Optional[Dict[str, Any]],
) -> Optional[str]:
    if not source or not target:
        return None
    source_path = source.get("cluster_path") or []
    target_path = target.get("cluster_path") or []

    folder_a = _find_cluster_id(source_path, "folder:")
    folder_b = _find_cluster_id(target_path, "folder:")
    if folder_a and folder_b and folder_a == folder_b:
        return "local"

    module_a = _find_cluster_id(source_path, "module:")
    module_b = _find_cluster_id(target_path, "module:")
    if module_a and module_b and module_a == module_b:
        return "cross-folder"

    package_a = _find_cluster_id(source_path, "package:")
    package_b = _find_cluster_id(target_path, "package:")
    if package_a and package_b and package_a == package_b:
        return "cross-module"

    return "cross-package"


def enrich_graph(graph: Dict[str, Any], git_metadata: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    nodes = graph.get("nodes", []) or []
    edges = graph.get("edges", []) or []

    line_cache: Dict[str, Optional[int]] = {}

    node_index = {node.get("id"): node for node in nodes if node.get("id")}
    git_meta = git_metadata or {}
    degree_map: Dict[str, int] = {}
    for edge in edges:
        source = edge.get("from")
        target = edge.get("to")
        if source:
            degree_map[source] = degree_map.get(source, 0) + 1
        if target:
            degree_map[target] = degree_map.get(target, 0) + 1

    for node in nodes:
        if not node.get("id"):
            continue
        node["kind"] = _infer_kind(node)
        node["layer"] = _infer_layer(node)
        node["externality"] = _infer_externality(node)
        if node.get("generated") is None:
            node["generated"] = _infer_generated(node)
        entrypoint = _infer_entrypoint(node)
        if entrypoint is not None and node.get("entrypoint") is None:
            node["entrypoint"] = entrypoint
        if node.get("label_short") is None:
            node["label_short"] = _short_label(node)

        if node.get("size") is None:
            node["size"] = _file_line_count(node.get("file"), line_cache)
        if node.get("importance") is None:
            node["importance"] = degree_map.get(node["id"], 0)

        if not node.get("cluster_id") or not node.get("cluster_path"):
            cluster_id, cluster_path = _cluster_path(node)
            if node.get("cluster_id") is None and cluster_id:
                node["cluster_id"] = cluster_id
            if node.get("cluster_path") is None and cluster_path:
                node["cluster_path"] = cluster_path

        rel_path = _rel_path(node.get("file"))
        meta = git_meta.get(rel_path or "") if rel_path else None
        if meta:
            if node.get("hotness") is None:
                node["hotness"] = meta.get("change_count_30d") or meta.get("change_count")
            if node.get("bus_factor") is None:
                node["bus_factor"] = meta.get("unique_authors")

    edge_pairs = {(edge.get("from"), edge.get("to")) for edge in edges}
    for edge in edges:
        if edge.get("weight") is None:
            edge["weight"] = 1
        if edge.get("confidence") is None:
            edge["confidence"] = "static"
        if edge.get("bidirectional") is None:
            source = edge.get("from")
            target = edge.get("to")
            if source and target:
                edge["bidirectional"] = (target, source) in edge_pairs
        if edge.get("distance_class") is None:
            source_node = node_index.get(edge.get("from"))
            target_node = node_index.get(edge.get("to"))
            edge["distance_class"] = _distance_class(source_node, target_node)

    graph["generated_at"] = graph.get("generated_at") or _utc_now_iso()
    return graph


def main() -> None:
    parser = argparse.ArgumentParser(description="Enrich graph nodes/edges with LOD metadata.")
    parser.add_argument(
        "--graph",
        default="docs/architecture/codebase-graph/codebase-graph.unified.json",
        help="Unified graph JSON path",
    )
    parser.add_argument(
        "--git-metadata",
        default="docs/architecture/codebase-graph/codebase-graph.git-metadata.json",
        help="Optional git metadata JSON path",
    )
    parser.add_argument(
        "--out",
        default=None,
        help="Output path (defaults to --graph)",
    )
    args = parser.parse_args()

    graph_path = Path(args.graph)
    graph = _load_json(graph_path)

    git_metadata = None
    git_path = Path(args.git_metadata)
    if git_path.exists():
        git_metadata = _load_json(git_path)

    enriched = enrich_graph(graph, git_metadata)
    out_path = Path(args.out) if args.out else graph_path
    _write_json(out_path, enriched)


if __name__ == "__main__":
    main()
