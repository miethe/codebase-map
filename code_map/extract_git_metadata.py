from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path
from typing import Any, Dict, Iterable, List


def _run_git(args: Iterable[str]) -> str:
    result = subprocess.run(
        ["git", *args],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "git command failed")
    return result.stdout


def extract_git_metadata() -> Dict[str, Dict[str, Any]]:
    files_output = _run_git(["ls-files"])
    files = [line.strip() for line in files_output.splitlines() if line.strip()]
    stats: Dict[str, Dict[str, Any]] = {
        path: {"changes": 0, "last_modified": 0, "authors": set()} for path in files
    }

    log_output = _run_git(["log", "--name-only", "--format=###%at|%an"])
    current_timestamp = 0
    current_author = ""
    for line in log_output.splitlines():
        entry = line.strip()
        if not entry:
            continue
        if entry.startswith("###"):
            parts = entry[3:].split("|", 1)
            if parts and parts[0].isdigit():
                current_timestamp = int(parts[0]) * 1000
            else:
                current_timestamp = 0
            current_author = parts[1] if len(parts) > 1 else ""
            continue
        file_path = entry
        if file_path not in stats:
            continue
        record = stats[file_path]
        record["changes"] += 1
        if current_author:
            record["authors"].add(current_author)
        if record["last_modified"] == 0 and current_timestamp:
            record["last_modified"] = current_timestamp

    output: Dict[str, Dict[str, Any]] = {}
    for path, record in stats.items():
        output[path] = {
            "last_modified": record["last_modified"],
            "change_count": record["changes"],
            "unique_authors": len(record["authors"]),
        }
    return output


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Extract git metadata for files in the repository."
    )
    parser.add_argument(
        "--out",
        default="docs/architecture/codebase-graph/codebase-graph.git-metadata.json",
        help="Output JSON path",
    )
    args = parser.parse_args()

    payload = extract_git_metadata()
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=True)
        handle.write("\n")


if __name__ == "__main__":
    main()
