from __future__ import annotations

import argparse
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

try:
    from .graph import Graph
    from .frontend_utils import apply_api_prefix, get_api_prefix, normalize_api_path, parse_imports, resolve_module_path
    from .metadata_utils import build_common_metadata, jsdoc_summary, offset_to_line_column, signature_from_line
except ImportError:  # pragma: no cover - fallback for direct script execution
    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    from scripts.code_map.graph import Graph
    from scripts.code_map.frontend_utils import apply_api_prefix, get_api_prefix, normalize_api_path, parse_imports, resolve_module_path
    from scripts.code_map.metadata_utils import (
        build_common_metadata,
        jsdoc_summary,
        offset_to_line_column,
        signature_from_line,
    )

EXPORT_FUNC_RE = re.compile(r"export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(")
EXPORT_CONST_RE = re.compile(r"export\s+const\s+([A-Za-z0-9_]+)\s*=\s*(?:async\s*)?\(")
API_REQUEST_RE = re.compile(r"apiRequest(?:<[^>]*>)?\(\s*([`'\"])(.+?)\1", re.DOTALL)
FETCH_RE = re.compile(r"fetch\(\s*([`'\"])(/.+?)\1", re.DOTALL)
BUILD_URL_RE = re.compile(r"build(?:Url|ApiUrl)\(\s*([`'\"])(.+?)\1", re.DOTALL)
METHOD_RE = re.compile(r"method\s*:\s*['\"]([A-Z]+)['\"]")
HOOK_EXPORT_FUNC_RE = re.compile(r"export\s+function\s+(use[A-Za-z0-9_]+)\b")
HOOK_EXPORT_CONST_RE = re.compile(r"export\s+const\s+(use[A-Za-z0-9_]+)\b")


def iter_api_files(web_root: Path) -> List[Path]:
    files: List[Path] = []
    api_root = web_root / "lib" / "api"
    if api_root.exists():
        files.extend(api_root.rglob("*.ts"))
    api_file = web_root / "lib" / "api.ts"
    if api_file.exists():
        files.append(api_file)
    return files


def extract_exported_functions(text: str) -> List[Tuple[str, int, Dict[str, Any]]]:
    matches: List[Tuple[str, int, Dict[str, Any]]] = []
    for regex in (EXPORT_FUNC_RE, EXPORT_CONST_RE):
        for match in regex.finditer(text):
            name = match.group(1)
            start = match.start()
            line, column = offset_to_line_column(text, start)
            end_line, end_column = offset_to_line_column(text, match.end())
            matches.append(
                (
                    name,
                    start,
                    {
                        "line": line,
                        "span": {
                            "start": {"line": line, "column": column},
                            "end": {"line": end_line, "column": end_column},
                        },
                        "signature": signature_from_line(text, start),
                        "doc_summary": jsdoc_summary(text, start),
                    },
                )
            )
    return sorted(matches, key=lambda item: item[1])


def slice_functions(text: str, functions: List[Tuple[str, int, Dict[str, Any]]]) -> Dict[str, str]:
    sliced: Dict[str, str] = {}
    for index, (name, start, _) in enumerate(functions):
        end = functions[index + 1][1] if index + 1 < len(functions) else len(text)
        sliced[name] = text[start:end]
    return sliced


def find_endpoints(text: str) -> List[Tuple[str, Optional[str], int, str]]:
    endpoints: List[Tuple[str, Optional[str], int, str]] = []
    for match in API_REQUEST_RE.finditer(text):
        path = match.group(2)
        window = text[match.end() : match.end() + 300]
        method_match = METHOD_RE.search(window)
        method = method_match.group(1) if method_match else None
        endpoints.append((path, method, match.start(), "apiRequest"))
    for match in BUILD_URL_RE.finditer(text):
        path = match.group(2)
        window = text[match.end() : match.end() + 300]
        method_match = METHOD_RE.search(window)
        method = method_match.group(1) if method_match else None
        endpoints.append((path, method, match.start(), "buildApiUrl"))
    for match in FETCH_RE.finditer(text):
        path = match.group(2)
        endpoints.append((path, None, match.start(), "fetch"))
    return endpoints


def api_client_node_id(path: Path, name: str) -> str:
    return f"api_client:{path.as_posix()}::{name}"


def hook_node_ids(path: Path, names: Sequence[str]) -> List[str]:
    return [f"hook:{path.as_posix()}::{name}" for name in names]


def extract_frontend_api_clients(web_root: Path) -> Graph:
    graph = Graph(source="frontend")
    api_files = iter_api_files(web_root)
    api_prefix = get_api_prefix()

    exported_functions: Dict[Path, List[str]] = {}
    exported_metadata: Dict[Path, Dict[str, Dict[str, Any]]] = {}
    export_to_file: Dict[str, Path] = {}

    for api_file in api_files:
        text = api_file.read_text(encoding="utf-8")
        export_matches = extract_exported_functions(text)
        functions = [name for name, _, _ in export_matches]
        if not functions:
            continue
        exported_functions[api_file] = functions
        exported_metadata[api_file] = {}
        for name, _, meta in export_matches:
            export_to_file.setdefault(name, api_file)
            exported_metadata[api_file][name] = meta
            graph.add_node(
                api_client_node_id(api_file, name),
                "api_client",
                label=name,
                file=api_file.as_posix(),
                **build_common_metadata(
                    api_file,
                    symbol=name,
                    line=meta.get("line"),
                    span=meta.get("span"),
                    signature=meta.get("signature"),
                    doc_summary=meta.get("doc_summary"),
                ),
            )
        function_slices = slice_functions(text, export_matches)
        function_offsets = {name: start for name, start, _ in export_matches}
        for name, body in function_slices.items():
            for raw_path, method, offset, method_name in find_endpoints(body):
                normalized_path = normalize_api_path(raw_path)
                full_path = apply_api_prefix(normalized_path, api_prefix)
                method_inferred = False
                raw_method = method
                if not method:
                    method = "GET"
                    method_inferred = True
                endpoint_label = f"{method} {full_path}"
                endpoint_id = f"api_endpoint:{endpoint_label}"
                absolute_offset = function_offsets.get(name, 0) + offset
                call_line, _ = offset_to_line_column(text, absolute_offset)
                graph.add_node(
                    endpoint_id,
                    "api_endpoint",
                    label=endpoint_label,
                    method=method,
                    path=full_path,
                    raw_path=raw_path,
                    normalized_path=full_path,
                    method_inferred=method_inferred,
                    raw_method="unknown" if method_inferred else raw_method,
                    file=api_file.as_posix(),
                    **build_common_metadata(api_file),
                )
                graph.add_edge(
                    api_client_node_id(api_file, name),
                    endpoint_id,
                    "api_client_calls_endpoint",
                    callsite_file=api_file.as_posix(),
                    callsite_line=call_line,
                    method_name=method_name,
                    raw_path=raw_path,
                    normalized_path=full_path,
                    method_inferred=method_inferred,
                )

    hooks_root = web_root / "hooks"
    if hooks_root.exists():
        for hook_path in hooks_root.rglob("*.ts*"):
            text = hook_path.read_text(encoding="utf-8")
            imports = parse_imports(text)
            hook_exports = set(HOOK_EXPORT_FUNC_RE.findall(text))
            hook_exports.update(HOOK_EXPORT_CONST_RE.findall(text))
            hook_names = sorted(hook_exports)
            if not hook_names:
                continue
            for names, module in imports:
                if not module.startswith("@/lib/api") and not module.startswith("."):
                    continue
                resolved = resolve_module_path(web_root, hook_path, module)
                for name in names:
                    target_path = resolved
                    if not target_path and module.startswith("@/lib/api"):
                        target_path = export_to_file.get(name)
                    if not target_path:
                        continue
                    client_id = api_client_node_id(target_path, name)
                    client_meta = (exported_metadata.get(target_path) or {}).get(name, {})
                    graph.add_node(
                        client_id,
                        "api_client",
                        label=name,
                        file=target_path.as_posix(),
                        **build_common_metadata(
                            target_path,
                            symbol=name,
                            line=client_meta.get("line"),
                            span=client_meta.get("span"),
                            signature=client_meta.get("signature"),
                            doc_summary=client_meta.get("doc_summary"),
                        ),
                    )
                    for hook_id in hook_node_ids(hook_path, hook_names):
                        graph.add_node(
                            hook_id,
                            "hook",
                            label=hook_id.split("::")[-1],
                            file=hook_path.as_posix(),
                            **build_common_metadata(hook_path, symbol=hook_id.split("::")[-1]),
                        )
                        graph.add_edge(
                            hook_id,
                            client_id,
                            "hook_calls_api_client",
                            via="api_client",
                            callsite_file=hook_path.as_posix(),
                        )

    return graph


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract frontend API client graph.")
    parser.add_argument(
        "--web-root",
        default="skillmeat/web",
        help="Path to web root (default: skillmeat/web)",
    )
    parser.add_argument(
        "--out",
        default="docs/architecture/codebase-graph/codebase-graph.frontend.api-clients.json",
        help="Output JSON path",
    )
    args = parser.parse_args()

    graph = extract_frontend_api_clients(Path(args.web_root))
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    graph.write_json(args.out)


if __name__ == "__main__":
    main()
