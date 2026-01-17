from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Dict, List, Optional


def _load_package_json(path: Path) -> Optional[Dict[str, Any]]:
    if not path.exists():
        return None
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _dependency_nodes(deps: Dict[str, str], dep_type: str) -> List[Dict[str, Any]]:
    nodes: List[Dict[str, Any]] = []
    for name, version in deps.items():
        node_id = f"node_modules/{name}"
        nodes.append(
            {
                "id": node_id,
                "type": "external_dependency",
                "label": name,
                "file": "package.json",
                "details": {"version": version, "deptype": dep_type},
                "modulePath": ["External", "Production" if dep_type == "dependencies" else "Dev"],
            }
        )
    return nodes


def scan_dependencies(repo_root: Path) -> Dict[str, Any]:
    pkg_path = repo_root / "package.json"
    pkg = _load_package_json(pkg_path)
    nodes: List[Dict[str, Any]] = []
    if pkg:
        dependencies = pkg.get("dependencies") or {}
        dev_dependencies = pkg.get("devDependencies") or {}
        nodes.extend(_dependency_nodes(dependencies, "dependencies"))
        nodes.extend(_dependency_nodes(dev_dependencies, "devDependencies"))
    return {"nodes": nodes, "edges": []}


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Scan external dependencies from package.json."
    )
    parser.add_argument(
        "--out",
        default="docs/architecture/codebase-graph/codebase-graph.dependencies.json",
        help="Output JSON path",
    )
    parser.add_argument(
        "--repo-root",
        default=".",
        help="Repository root",
    )
    args = parser.parse_args()

    payload = scan_dependencies(Path(args.repo_root))
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=True)
        handle.write("\n")


if __name__ == "__main__":
    main()
