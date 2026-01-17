from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
import subprocess
from typing import Any, Dict, List, Optional


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
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=_get_repo_root(),
            capture_output=True,
            text=True,
            check=False,
        )
    except Exception:
        return "unknown"
    if result.returncode != 0:
        return "unknown"
    return result.stdout.strip() or "unknown"


@dataclass
class Graph:
    source: str
    schema_version: str = "v1"
    generated_at: str = field(default_factory=_utc_now_iso)
    source_commit: str = field(default_factory=_get_source_commit)
    nodes: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    edges: List[Dict[str, Any]] = field(default_factory=list)

    def add_node(
        self,
        node_id: str,
        node_type: str,
        label: Optional[str] = None,
        file: Optional[str] = None,
        **extra: Any,
    ) -> None:
        if node_id in self.nodes:
            existing = self.nodes[node_id]
            existing.update({k: v for k, v in extra.items() if v is not None})
            if label and not existing.get("label"):
                existing["label"] = label
            if file and not existing.get("file"):
                existing["file"] = file
            return
        node = {"id": node_id, "type": node_type}
        if label:
            node["label"] = label
        if file:
            node["file"] = file
        for key, value in extra.items():
            if value is not None:
                node[key] = value
        self.nodes[node_id] = node

    def add_edge(
        self,
        from_id: str,
        to_id: str,
        edge_type: str,
        **extra: Any,
    ) -> None:
        edge = {"from": from_id, "to": to_id, "type": edge_type}
        for key, value in extra.items():
            if value is not None:
                edge[key] = value
        self.edges.append(edge)

    def merge(self, other: "Graph") -> None:
        for node_id, node in other.nodes.items():
            if node_id not in self.nodes:
                self.nodes[node_id] = node
                continue
            existing = self.nodes[node_id]
            for key, value in node.items():
                if key not in existing or existing[key] in (None, "", [], {}):
                    if value not in (None, "", [], {}):
                        existing[key] = value
        self.edges.extend(other.edges)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "source": self.source,
            "schema_version": self.schema_version,
            "generated_at": self.generated_at,
            "source_commit": self.source_commit,
            "nodes": list(self.nodes.values()),
            "edges": self.edges,
        }

    def write_json(self, path: str) -> None:
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(self.to_dict(), handle, indent=2, sort_keys=True)
            handle.write("\n")
