from __future__ import annotations

import argparse
import json
import os
import re
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

try:
    from .graph import Graph
    from .metadata_utils import build_common_metadata
except ImportError:  # pragma: no cover - fallback for direct script execution
    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    from scripts.code_map.graph import Graph
    from scripts.code_map.metadata_utils import build_common_metadata


def _normalize_path_params(path: str) -> str:
    return re.sub(r"\{([^}:]+):[^}]+\}", r"{\1}", path)


def _schema_name_from_ref(ref: str) -> Optional[str]:
    if not ref:
        return None
    if "#/components/schemas/" in ref:
        return ref.split("#/components/schemas/")[-1]
    return ref


def _extract_schema(content: Dict[str, Any]) -> Optional[str]:
    if not content:
        return None
    for media_type in ("application/json", "application/*+json", "*/*"):
        payload = content.get(media_type)
        if not payload:
            continue
        schema = payload.get("schema") or {}
        if "$ref" in schema:
            return _schema_name_from_ref(schema["$ref"])
        if "items" in schema and isinstance(schema["items"], dict):
            ref = schema["items"].get("$ref")
            if ref:
                return _schema_name_from_ref(ref)
        return schema.get("title")
    return None


def _primary_response_schema(responses: Dict[str, Any]) -> Tuple[Optional[str], List[str]]:
    status_codes = sorted(responses.keys()) if responses else []
    preferred = None
    for code in ("200", "201", "204"):
        if code in responses:
            preferred = code
            break
    if preferred is None and status_codes:
        preferred = status_codes[0]
    if not preferred:
        return None, status_codes
    content = (responses.get(preferred) or {}).get("content") or {}
    return _extract_schema(content), status_codes


def _openapi_is_stale(path: Path) -> bool:
    if not path.exists():
        return True
    repo_root = Path(__file__).resolve().parents[2]
    api_root = repo_root / "skillmeat" / "api"
    routers_root = api_root / "routers"
    candidates = []
    if routers_root.exists():
        candidates.extend(routers_root.rglob("*.py"))
    server_file = api_root / "server.py"
    if server_file.exists():
        candidates.append(server_file)
    if not candidates:
        return False
    spec_mtime = path.stat().st_mtime
    return any(candidate.stat().st_mtime > spec_mtime for candidate in candidates)


def _load_openapi(path: Path) -> Dict[str, Any]:
    force_refresh = os.environ.get("CODEBASE_GRAPH_REFRESH_OPENAPI") == "1"
    if force_refresh and path.exists():
        try:
            from skillmeat.api.openapi import export_openapi_spec
            from skillmeat.api.server import create_app
        except Exception:
            pass
        else:
            app = create_app()
            export_openapi_spec(app, output_path=path)
    elif not path.exists():
        try:
            from skillmeat.api.openapi import export_openapi_spec
            from skillmeat.api.server import create_app
        except Exception as exc:
            raise FileNotFoundError(path) from exc
        app = create_app()
        export_openapi_spec(app, output_path=path)
    elif _openapi_is_stale(path):
        try:
            from skillmeat.api.openapi import export_openapi_spec
            from skillmeat.api.server import create_app
        except Exception:
            pass
        else:
            app = create_app()
            export_openapi_spec(app, output_path=path)
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _iter_operations(spec: Dict[str, Any]) -> Iterable[tuple[str, str, Dict[str, Any]]]:
    for raw_path, methods in (spec.get("paths") or {}).items():
        for method, operation in methods.items():
            if method.lower() not in {"get", "post", "put", "patch", "delete", "options", "head"}:
                continue
            yield raw_path, method.upper(), operation


def extract_backend_openapi(openapi_path: Path) -> Graph:
    graph = Graph(source="backend")
    spec = _load_openapi(openapi_path)

    for raw_path, method, operation in _iter_operations(spec):
        normalized_path = _normalize_path_params(raw_path)
        label = f"{method} {normalized_path}"
        node_id = f"api_endpoint:{label}"
        tags = operation.get("tags") or []
        request_schema = None
        request_body = operation.get("requestBody") or {}
        if request_body:
            request_schema = _extract_schema(request_body.get("content") or {})
        response_schema, status_codes = _primary_response_schema(
            operation.get("responses") or {}
        )
        security = operation.get("security", spec.get("security")) or []
        if security:
            schemes = sorted({name for item in security for name in item.keys()})
            auth_required = schemes or True
        else:
            auth_required = False
        graph.add_node(
            node_id,
            "api_endpoint",
            label=label,
            method=method,
            path=normalized_path,
            raw_path=raw_path,
            normalized_path=normalized_path,
            operation_id=operation.get("operationId"),
            summary=operation.get("summary"),
            tags=tags or None,
            auth_required=auth_required,
            request_schema=request_schema,
            response_schema=response_schema,
            status_codes=status_codes,
            openapi=True,
            file=openapi_path.as_posix(),
            **build_common_metadata(openapi_path),
        )
    return graph


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract backend endpoints from OpenAPI spec.")
    parser.add_argument(
        "--openapi",
        default="skillmeat/api/openapi.json",
        help="Path to OpenAPI JSON (default: skillmeat/api/openapi.json)",
    )
    parser.add_argument(
        "--out",
        default="docs/architecture/codebase-graph/codebase-graph.backend.openapi.json",
        help="Output JSON path",
    )
    args = parser.parse_args()

    graph = extract_backend_openapi(Path(args.openapi))
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    graph.write_json(args.out)


if __name__ == "__main__":
    main()
