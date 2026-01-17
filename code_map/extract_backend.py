from __future__ import annotations

import argparse
import re
from pathlib import Path
from typing import Dict, Optional

try:
    from .graph import Graph
    from .extract_backend_openapi import extract_backend_openapi
    from .extract_backend_handlers import extract_backend_handlers
    from .extract_backend_services import extract_backend_services
    from .extract_backend_models import extract_backend_models
    from .metadata_utils import build_common_metadata
except ImportError:  # pragma: no cover - fallback for direct script execution
    import sys
    from pathlib import Path as _Path

    sys.path.insert(0, str(_Path(__file__).resolve().parents[2]))
    from scripts.code_map.graph import Graph
    from scripts.code_map.extract_backend_openapi import extract_backend_openapi
    from scripts.code_map.extract_backend_handlers import extract_backend_handlers
    from scripts.code_map.extract_backend_services import extract_backend_services
    from scripts.code_map.extract_backend_models import extract_backend_models
    from scripts.code_map.metadata_utils import build_common_metadata

ROUTER_ASSIGN_RE = re.compile(
    r"(?P<name>\w+)\s*=\s*APIRouter\((?P<args>.*?)\)",
    re.DOTALL,
)
PREFIX_RE = re.compile(r"prefix\s*=\s*['\"]([^'\"]+)['\"]")
DECORATOR_RE = re.compile(
    r"@(?P<router>\w+)\.(?P<method>get|post|put|patch|delete|options|head)\((?P<args>.*?)\)",
    re.DOTALL,
)
STRING_RE = re.compile(r"['\"]([^'\"]*)['\"]")
DEF_RE = re.compile(r"(?m)^(?:async\s+def|def)\s+([A-Za-z0-9_]+)\b")


def parse_router_prefixes(text: str) -> Dict[str, str]:
    prefixes: Dict[str, str] = {}
    for match in ROUTER_ASSIGN_RE.finditer(text):
        name = match.group("name")
        args = match.group("args")
        prefix_match = PREFIX_RE.search(args)
        if prefix_match:
            prefixes[name] = prefix_match.group(1)
    return prefixes


def join_paths(prefix: str, path: str) -> str:
    if not prefix:
        return path
    if not path:
        return prefix
    if prefix.endswith("/") and path.startswith("/"):
        return prefix[:-1] + path
    if not prefix.endswith("/") and not path.startswith("/"):
        return prefix + "/" + path
    return prefix + path


def apply_api_prefix(api_prefix: Optional[str], path: str) -> str:
    if not api_prefix:
        return path
    api_prefix = api_prefix.rstrip("/")
    return join_paths(api_prefix, path)


def normalize_path_params(path: str) -> str:
    return re.sub(r"\{([^}:]+):[^}]+\}", r"{\1}", path)


def find_next_handler(text: str, start: int) -> Optional[str]:
    match = DEF_RE.search(text, start)
    if not match:
        return None
    return match.group(1)


def extract_backend(api_root: Path) -> Graph:
    routers_root = api_root / "routers"
    graph = Graph(source="backend")
    api_prefix = ""
    try:
        from skillmeat.api.config import get_settings
    except Exception:
        api_prefix = ""
    else:
        api_prefix = get_settings().api_prefix

    for router_file in routers_root.rglob("*.py"):
        text = router_file.read_text(encoding="utf-8")
        prefixes = parse_router_prefixes(text)
        apply_prefix = router_file.name != "health.py"

        for match in DECORATOR_RE.finditer(text):
            router_name = match.group("router")
            method = match.group("method").upper()
            args = match.group("args")
            path_match = STRING_RE.search(args)
            if not path_match:
                continue
            decorator_path = path_match.group(1)
            raw_path = normalize_path_params(decorator_path)
            prefix = prefixes.get(router_name, "")
            full_path = join_paths(prefix, raw_path)
            if apply_prefix:
                full_path = apply_api_prefix(api_prefix, full_path)

            handler_name = find_next_handler(text, match.end())
            if not handler_name:
                continue

            router_id = f"router:{router_file.as_posix()}::{router_name}"
            endpoint_id = f"api_endpoint:{method} {full_path}"
            handler_id = f"handler:{router_file.as_posix()}::{handler_name}"

            graph.add_node(
                router_id,
                "router",
                label=router_name,
                file=router_file.as_posix(),
                prefix=prefix or None,
                **build_common_metadata(router_file, symbol=router_name),
            )
            graph.add_node(
                endpoint_id,
                "api_endpoint",
                label=f"{method} {full_path}",
                method=method,
                path=full_path,
                raw_path=decorator_path,
                normalized_path=full_path,
                file=router_file.as_posix(),
                **build_common_metadata(router_file),
            )
            graph.add_node(
                handler_id,
                "handler",
                label=handler_name,
                file=router_file.as_posix(),
                **build_common_metadata(router_file, symbol=handler_name),
            )
            graph.add_edge(router_id, endpoint_id, "router_exposes")
            graph.add_edge(endpoint_id, handler_id, "handled_by")

    openapi_path = api_root / "openapi.json"
    try:
        graph.merge(extract_backend_openapi(openapi_path))
    except FileNotFoundError:
        pass
    graph.merge(extract_backend_handlers(api_root, api_prefix=api_prefix))
    graph.merge(extract_backend_services(api_root))
    graph.merge(extract_backend_models(api_root.parents[1]))

    return graph


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract backend code graph.")
    parser.add_argument(
        "--api-root",
        default="skillmeat/api",
        help="Path to API root (default: skillmeat/api)",
    )
    parser.add_argument(
        "--out",
        default="docs/architecture/codebase-graph/codebase-graph.backend.json",
        help="Output JSON path",
    )
    args = parser.parse_args()

    api_root = Path(args.api_root)
    graph = extract_backend(api_root)
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    graph.write_json(args.out)


if __name__ == "__main__":
    main()
