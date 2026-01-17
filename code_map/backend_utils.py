from __future__ import annotations

from pathlib import Path
from typing import Optional


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def module_to_path(module: str) -> Optional[Path]:
    if not module:
        return None
    if module.startswith("skillmeat."):
        rel = module.replace(".", "/") + ".py"
        candidate = repo_root() / rel
        if candidate.exists():
            return candidate
    return None


def resolve_relative_module(current_file: Path, module: str) -> Optional[Path]:
    if not module.startswith("."):
        return module_to_path(module)
    rel = module.lstrip(".")
    base = current_file.parent
    if rel:
        base = base / rel.replace(".", "/")
    candidate = base.with_suffix(".py")
    if candidate.exists():
        return candidate
    init_candidate = base / "__init__.py"
    if init_candidate.exists():
        return init_candidate
    return None
