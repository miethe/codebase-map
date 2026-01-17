from __future__ import annotations

import argparse
import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from fnmatch import fnmatchcase
from hashlib import sha1
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple


def _utc_now_iso() -> str:
    return (
        datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def _get_repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _get_source_commit() -> str:
    try:
        result = _run_git("rev-parse", "HEAD")
    except Exception:
        return "unknown"
    return result or "unknown"


def _run_git(*args: str) -> Optional[str]:
    import subprocess

    result = subprocess.run(
        ["git", *args],
        cwd=_get_repo_root(),
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        return None
    return result.stdout.strip() or None


def _load_json(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _write_json(path: Path, payload: Dict[str, Any]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=True)
        handle.write("\n")


def _ensure_list(value: Any) -> List[str]:
    if not value:
        return []
    if isinstance(value, list):
        return [str(item) for item in value if str(item)]
    return [str(value)]


def _rel_path(path_value: str) -> Optional[str]:
    if not path_value:
        return None
    path = Path(path_value)
    repo_root = _get_repo_root()
    try:
        rel = path.resolve().relative_to(repo_root)
    except Exception:
        rel = path
    return rel.as_posix()


def _dir_for_path(path_value: Optional[str]) -> Optional[str]:
    if not path_value:
        return None
    rel = _rel_path(path_value)
    if not rel:
        return None
    if "/" not in rel:
        return "."
    return rel.rsplit("/", 1)[0] or "."


def _hash_group_id(nodes: Iterable[str]) -> str:
    joined = ",".join(sorted(nodes))
    return sha1(joined.encode("utf-8")).hexdigest()[:10]


def _common_path_prefix(paths: Iterable[str]) -> Optional[str]:
    parts_list = [path.split("/") for path in paths if path]
    if not parts_list:
        return None
    prefix: list[str] = []
    for items in zip(*parts_list):
        if len(set(items)) != 1:
            break
        prefix.append(items[0])
    if not prefix:
        return None
    return "/".join(prefix)


def _label_for_component(component_nodes: List[Dict[str, Any]]) -> str:
    packages = [node.get("package") for node in component_nodes if node.get("package")]
    if packages and len(set(packages)) == 1:
        return f"package:{packages[0]}"
    directories = [
        _dir_for_path(node.get("file"))
        for node in component_nodes
        if node.get("file")
    ]
    common_dir = _common_path_prefix([d for d in directories if d])
    if common_dir:
        return f"dir:{common_dir}"
    types = [node.get("type") for node in component_nodes if node.get("type")]
    if types:
        counts: Dict[str, int] = {}
        for node_type in types:
            counts[node_type] = counts.get(node_type, 0) + 1
        top_type = max(counts.items(), key=lambda item: item[1])[0]
        return f"type:{top_type}"
    return "cluster"


@dataclass
class GroupSet:
    id: str
    label: str
    source: str
    multi_membership: bool = False
    metadata: Dict[str, Any] = field(default_factory=dict)


def _load_codeowners(repo_root: Path) -> List[Tuple[str, List[str]]]:
    candidates = [
        repo_root / "CODEOWNERS",
        repo_root / ".github" / "CODEOWNERS",
        repo_root / "docs" / "CODEOWNERS",
    ]
    path = next((item for item in candidates if item.exists()), None)
    if not path:
        return []
    entries: List[Tuple[str, List[str]]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        parts = stripped.split()
        if len(parts) < 2:
            continue
        pattern = parts[0]
        owners = parts[1:]
        entries.append((pattern, owners))
    return entries


def _match_codeowners(path_value: str, entries: List[Tuple[str, List[str]]]) -> List[str]:
    if not entries:
        return []
    rel = _rel_path(path_value)
    if not rel:
        return []
    rel = rel.lstrip("./")
    matches: List[str] = []
    for pattern, owners in entries:
        normalized = pattern.lstrip("/")
        if pattern.startswith("/"):
            glob = normalized
        elif "/" in normalized:
            glob = normalized
        else:
            glob = f"**/{normalized}"
        if fnmatchcase(rel, glob):
            matches = owners
    return matches


def build_groupings(graph: Dict[str, Any]) -> Dict[str, Any]:
    nodes = graph.get("nodes", []) or []
    edges = graph.get("edges", []) or []
    repo_root = _get_repo_root()
    codeowners = _load_codeowners(repo_root)

    group_sets = [
        GroupSet(
            id="structure",
            label="Workspace/Package/Directory",
            source="extractor",
        ),
        GroupSet(
            id="layer",
            label="Node Type",
            source="extractor",
        ),
        GroupSet(
            id="ownership",
            label="CODEOWNERS/Overrides",
            source="extractor",
            multi_membership=True,
        ),
        GroupSet(
            id="semantic_domain",
            label="Domain Tags",
            source="annotation",
            multi_membership=True,
        ),
        GroupSet(
            id="semantic_module",
            label="Module Tags",
            source="annotation",
            multi_membership=True,
        ),
        GroupSet(
            id="computed",
            label="Computed Clusters",
            source="analysis",
            metadata={
                "algorithm": "connected_components",
                "singletons_excluded": True,
            },
        ),
    ]

    groups: Dict[Tuple[str, str], Dict[str, Any]] = {}

    def add_group(
        group_set_id: str,
        group_id: str,
        label: str,
        node_id: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        key = (group_set_id, group_id)
        group = groups.get(key)
        if not group:
            group = {
                "group_set": group_set_id,
                "id": group_id,
                "label": label,
                "nodes": [],
            }
            if metadata:
                group["metadata"] = metadata
            groups[key] = group
        group["nodes"].append(node_id)

    for node in nodes:
        node_id = node.get("id")
        if not node_id:
            continue
        node_type = node.get("type")
        if node_type:
            add_group("layer", f"type:{node_type}", node_type, node_id)

        file_path = node.get("file")
        directory = _dir_for_path(file_path)
        package = node.get("package")
        if directory or package:
            package_label = package or "unknown-package"
            dir_label = directory or "."
            group_id = f"package:{package_label}/dir:{dir_label}"
            add_group(
                "structure",
                group_id,
                f"{package_label}/{dir_label}",
                node_id,
                {"package": package_label, "directory": dir_label},
            )

        owners = _ensure_list(node.get("owners") or node.get("owner"))
        if not owners and file_path:
            owners = _match_codeowners(file_path, codeowners)
        for owner in owners:
            add_group("ownership", f"owner:{owner}", owner, node_id)

        domains = _ensure_list(node.get("domains") or node.get("domain"))
        for domain in domains:
            add_group("semantic_domain", f"domain:{domain}", domain, node_id)

        modules = _ensure_list(node.get("module_tags") or node.get("module_tag"))
        for module in modules:
            add_group("semantic_module", f"module:{module}", module, node_id)

    adjacency: Dict[str, List[str]] = {
        node.get("id"): [] for node in nodes if node.get("id")
    }
    for edge in edges:
        from_id = edge.get("from")
        to_id = edge.get("to")
        if from_id in adjacency and to_id in adjacency:
            adjacency[from_id].append(to_id)
            adjacency[to_id].append(from_id)

    visited: set[str] = set()
    components: List[List[str]] = []
    for node_id in sorted(adjacency.keys()):
        if node_id in visited:
            continue
        queue = [node_id]
        visited.add(node_id)
        component: List[str] = []
        while queue:
            current = queue.pop()
            component.append(current)
            for neighbor in adjacency.get(current, []):
                if neighbor not in visited:
                    visited.add(neighbor)
                    queue.append(neighbor)
        components.append(sorted(component))

    node_index = {node.get("id"): node for node in nodes if node.get("id")}
    for component in components:
        if not component or len(component) <= 1:
            continue
        group_hash = _hash_group_id(component)
        component_nodes = [node_index[node_id] for node_id in component if node_id in node_index]
        group_id = f"component:{group_hash}"
        label_root = _label_for_component(component_nodes)
        label = f"{label_root} ({len(component)})"
        for node_id in component:
            add_group(
                "computed",
                group_id,
                label,
                node_id,
                {"size": len(component)},
            )

    payload = {
        "generated_at": _utc_now_iso(),
        "source_commit": _get_source_commit(),
        "group_sets": [
            {
                "id": group_set.id,
                "label": group_set.label,
                "source": group_set.source,
                "multi_membership": group_set.multi_membership,
                "metadata": group_set.metadata or {},
            }
            for group_set in group_sets
        ],
        "groups": sorted(groups.values(), key=lambda item: (item["group_set"], item["id"])),
    }
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description="Build grouping sets for the codebase graph.")
    parser.add_argument(
        "--graph",
        default="docs/architecture/codebase-graph/codebase-graph.unified.json",
        help="Unified graph JSON path",
    )
    parser.add_argument(
        "--out",
        default="docs/architecture/codebase-graph/codebase-graph.groupings.json",
        help="Output groupings JSON path",
    )
    args = parser.parse_args()

    graph = _load_json(Path(args.graph))
    payload = build_groupings(graph)
    _write_json(Path(args.out), payload)


if __name__ == "__main__":
    main()
