from __future__ import annotations

import argparse
import re
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Set, Tuple

try:
    from .graph import Graph
    from .frontend_utils import apply_api_prefix, get_api_prefix, normalize_api_path
    from .extract_frontend_components import extract_frontend_components
    from .extract_frontend_hooks import extract_frontend_hooks
    from .extract_frontend_api_clients import extract_frontend_api_clients
    from .metadata_utils import build_common_metadata, offset_to_line_column
except ImportError:  # pragma: no cover - fallback for direct script execution
    import sys
    from pathlib import Path as _Path

    sys.path.insert(0, str(_Path(__file__).resolve().parents[2]))
    from scripts.code_map.graph import Graph
    from scripts.code_map.frontend_utils import apply_api_prefix, get_api_prefix, normalize_api_path
    from scripts.code_map.extract_frontend_components import extract_frontend_components
    from scripts.code_map.extract_frontend_hooks import extract_frontend_hooks
    from scripts.code_map.extract_frontend_api_clients import extract_frontend_api_clients
    from scripts.code_map.metadata_utils import build_common_metadata, offset_to_line_column

IMPORT_RE = re.compile(
    r"import\s+\{([^}]+)\}\s+from\s+['\"]([^'\"]+)['\"]",
    re.DOTALL,
)
EXPORT_FUNC_RE = re.compile(r"export\s+function\s+(use[A-Za-z0-9_]+)\b")
EXPORT_CONST_RE = re.compile(r"export\s+const\s+(use[A-Za-z0-9_]+)\b")
API_REQUEST_RE = re.compile(
    r"apiRequest(?:<[^>]*>)?\(\s*([`'\"])(.+?)\1",
    re.DOTALL,
)
FETCH_RE = re.compile(r"fetch\(\s*([`'\"])(/.+?)\1", re.DOTALL)
METHOD_RE = re.compile(r"method\s*:\s*['\"]([A-Z]+)['\"]")


def iter_page_files(app_root: Path) -> Iterable[Path]:
    return app_root.rglob("page.tsx")


def route_from_page(app_root: Path, page_path: Path) -> str:
    relative = page_path.relative_to(app_root)
    parts = list(relative.parts)
    if not parts:
        return "/"
    parts.pop()
    route_parts = []
    for part in parts:
        if part.startswith("(") and part.endswith(")"):
            continue
        route_parts.append(part)
    if not route_parts:
        return "/"
    return "/" + "/".join(route_parts)


def parse_hook_exports(hooks_root: Path) -> Dict[Path, Set[str]]:
    exports: Dict[Path, Set[str]] = {}
    for hook_file in hooks_root.rglob("*.ts"):
        text = hook_file.read_text(encoding="utf-8")
        names = set(EXPORT_FUNC_RE.findall(text))
        names.update(EXPORT_CONST_RE.findall(text))
        if names:
            exports[hook_file] = names
    for hook_file in hooks_root.rglob("*.tsx"):
        text = hook_file.read_text(encoding="utf-8")
        names = set(EXPORT_FUNC_RE.findall(text))
        names.update(EXPORT_CONST_RE.findall(text))
        if names:
            exports[hook_file] = names
    return exports


def resolve_hook_import(web_root: Path, import_path: str) -> Optional[Path]:
    if not import_path.startswith("@/"):
        return None
    rel_path = import_path[2:]
    base = web_root / rel_path
    for suffix in (".ts", ".tsx"):
        candidate = base.with_suffix(suffix)
        if candidate.exists():
            return candidate
    return None


def parse_hook_imports(
    web_root: Path,
    page_path: Path,
    hook_exports: Dict[Path, Set[str]],
) -> List[Tuple[str, Optional[Path]]]:
    text = page_path.read_text(encoding="utf-8")
    imports: List[Tuple[str, Optional[Path]]] = []
    for match in IMPORT_RE.finditer(text):
        raw_names = match.group(1)
        module = match.group(2)
        if not module.startswith("@/hooks"):
            continue
        resolved = resolve_hook_import(web_root, module)
        for raw_name in raw_names.split(","):
            name = raw_name.strip().split(" as ")[0].strip()
            if not name.startswith("use"):
                continue
            if resolved and resolved in hook_exports and name not in hook_exports[resolved]:
                continue
            imports.append((name, resolved))
    return imports


def hook_node_id(name: str, hook_file: Optional[Path]) -> str:
    if hook_file:
        return f"hook:{hook_file.as_posix()}::{name}"
    return f"hook:{name}"


def parse_api_calls(text: str) -> List[Tuple[str, Optional[str], int, str]]:
    calls: List[Tuple[str, Optional[str], int, str]] = []
    for match in API_REQUEST_RE.finditer(text):
        path = match.group(2)
        window = text[match.end() : match.end() + 300]
        method_match = METHOD_RE.search(window)
        method = method_match.group(1) if method_match else None
        calls.append((path, method, match.start(), "apiRequest"))
    for match in FETCH_RE.finditer(text):
        path = match.group(2)
        calls.append((path, None, match.start(), "fetch"))
    return calls


def extract_frontend(web_root: Path) -> Graph:
    app_root = web_root / "app"
    hooks_root = web_root / "hooks"
    graph = Graph(source="frontend")
    api_prefix = get_api_prefix()

    hook_exports = parse_hook_exports(hooks_root)

    for page_path in iter_page_files(app_root):
        route = route_from_page(app_root, page_path)
        route_id = f"route:{route}"
        page_id = f"page:{page_path.as_posix()}"
        graph.add_node(route_id, "route", label=route)
        graph.add_node(
            page_id,
            "page",
            file=page_path.as_posix(),
            **build_common_metadata(page_path),
        )
        graph.add_edge(route_id, page_id, "route_to_page")

        for hook_name, hook_file in parse_hook_imports(web_root, page_path, hook_exports):
            hook_id = hook_node_id(hook_name, hook_file)
            graph.add_node(
                hook_id,
                "hook",
                label=hook_name,
                file=hook_file.as_posix() if hook_file else None,
                **build_common_metadata(hook_file, symbol=hook_name) if hook_file else {},
            )
            graph.add_edge(page_id, hook_id, "uses_hook")

    for hook_file, hook_names in hook_exports.items():
        text = hook_file.read_text(encoding="utf-8")
        api_calls = parse_api_calls(text)
        if not api_calls:
            continue
        for hook_name in hook_names:
            hook_id = hook_node_id(hook_name, hook_file)
            graph.add_node(
                hook_id,
                "hook",
                label=hook_name,
                file=hook_file.as_posix(),
                **build_common_metadata(hook_file, symbol=hook_name),
            )
            for raw_path, method, offset, method_name in api_calls:
                normalized_path = normalize_api_path(raw_path)
                full_path = apply_api_prefix(normalized_path, api_prefix)
                method_inferred = False
                raw_method = method
                if not method:
                    method = "GET"
                    method_inferred = True
                endpoint_label = f"{method} {full_path}"
                endpoint_id = f"api_endpoint:{endpoint_label}"
                call_line, _ = offset_to_line_column(text, offset)
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
                    **build_common_metadata(hook_file),
                )
                graph.add_edge(
                    hook_id,
                    endpoint_id,
                    "calls_api",
                    file=hook_file.as_posix(),
                    callsite_file=hook_file.as_posix(),
                    callsite_line=call_line,
                    method_name=method_name,
                    via="direct",
                    raw_path=raw_path,
                    normalized_path=full_path,
                    method_inferred=method_inferred,
                )

    graph.merge(extract_frontend_components(web_root))
    graph.merge(extract_frontend_hooks(web_root))
    graph.merge(extract_frontend_api_clients(web_root))

    return graph


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract frontend code graph.")
    parser.add_argument(
        "--web-root",
        default="skillmeat/web",
        help="Path to web root (default: skillmeat/web)",
    )
    parser.add_argument(
        "--out",
        default="docs/architecture/codebase-graph/codebase-graph.frontend.json",
        help="Output JSON path",
    )
    args = parser.parse_args()

    web_root = Path(args.web_root)
    graph = extract_frontend(web_root)
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    graph.write_json(args.out)


if __name__ == "__main__":
    main()
