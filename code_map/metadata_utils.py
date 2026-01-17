from __future__ import annotations

import ast
import re
from pathlib import Path
from typing import Any, Dict, Iterable, Optional, Tuple

REPO_ROOT = Path(__file__).resolve().parents[2]


def module_from_path(path: Path) -> Optional[str]:
    try:
        rel = path.resolve().relative_to(REPO_ROOT)
    except Exception:
        rel = path
    parts = list(rel.parts)
    if not parts:
        return None
    if parts[-1] == "__init__.py":
        parts = parts[:-1]
    else:
        parts[-1] = Path(parts[-1]).stem
    if not parts:
        return None
    return ".".join(parts)


def package_from_path(path: Path) -> Optional[str]:
    try:
        rel = path.resolve().relative_to(REPO_ROOT)
    except Exception:
        rel = path
    parts = list(rel.parts)
    if "skillmeat" not in parts:
        return None
    idx = parts.index("skillmeat")
    if idx + 1 < len(parts):
        return f"skillmeat.{parts[idx + 1]}"
    return "skillmeat"


def doc_summary_from_docstring(docstring: Optional[str]) -> Optional[str]:
    if not docstring:
        return None
    for line in docstring.strip().splitlines():
        stripped = line.strip()
        if stripped:
            return stripped
    return None


def span_from_ast(node: ast.AST) -> Optional[Dict[str, Any]]:
    start_line = getattr(node, "lineno", None)
    start_col = getattr(node, "col_offset", None)
    if start_line is None or start_col is None:
        return None
    end_line = getattr(node, "end_lineno", None)
    end_col = getattr(node, "end_col_offset", None)
    span: Dict[str, Any] = {
        "start": {"line": start_line, "column": start_col + 1},
    }
    if end_line is not None and end_col is not None:
        span["end"] = {"line": end_line, "column": end_col + 1}
    return span


def offset_to_line_column(text: str, index: int) -> Tuple[int, int]:
    if index < 0:
        index = 0
    line = text.count("\n", 0, index) + 1
    last_newline = text.rfind("\n", 0, index)
    if last_newline == -1:
        column = index + 1
    else:
        column = index - last_newline
    return line, column


def signature_from_line(text: str, start_index: int) -> Optional[str]:
    line_start = text.rfind("\n", 0, start_index) + 1
    line_end = text.find("\n", start_index)
    if line_end == -1:
        line_end = len(text)
    line = text[line_start:line_end].strip()
    if not line:
        return None
    line = re.sub(r"\s*{\s*$", "", line)
    line = re.sub(r"\s*=>\s*$", "", line)
    return line.strip()


def jsdoc_block(text: str, start_index: int) -> Optional[str]:
    prefix = text[:start_index]
    lines = prefix.splitlines()
    i = len(lines) - 1
    while i >= 0 and not lines[i].strip():
        i -= 1
    if i < 0:
        return None
    if lines[i].strip().startswith("//"):
        return lines[i].strip().lstrip("/").strip()
    if not lines[i].strip().endswith("*/"):
        return None
    j = i
    while j >= 0 and "/*" not in lines[j]:
        j -= 1
    if j < 0:
        return None
    if not lines[j].strip().startswith("/**"):
        return None
    content: list[str] = []
    for line in lines[j + 1 : i + 1]:
        cleaned = line.strip()
        if cleaned.startswith("*"):
            cleaned = cleaned[1:].lstrip()
        content.append(cleaned)
    return "\n".join(content).strip() or None


def jsdoc_summary(text: str, start_index: int) -> Optional[str]:
    block = jsdoc_block(text, start_index)
    if not block:
        return None
    for line in block.splitlines():
        stripped = line.strip()
        if stripped and not stripped.startswith("@"):
            return stripped
    return None


def parse_semantic_tags(text: Optional[str]) -> Dict[str, list[str]]:
    if not text:
        return {}
    domains: list[str] = []
    modules: list[str] = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if line.startswith("*"):
            line = line.lstrip("*").strip()
        if not line.startswith("@"):
            continue
        match = re.match(r"^@(domain|module)\s+(.*)$", line, re.IGNORECASE)
        if not match:
            continue
        key = match.group(1).lower()
        value = match.group(2).strip()
        if not value:
            continue
        parts = [part.strip() for part in value.split(",") if part.strip()]
        if key == "domain":
            domains.extend(parts)
        else:
            modules.extend(parts)
    result: Dict[str, list[str]] = {}
    if domains:
        result["domains"] = domains
    if modules:
        result["modules"] = modules
    return result


def format_python_signature(node: ast.AST) -> Optional[str]:
    if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        return None
    parts = []
    for arg in node.args.posonlyargs:
        parts.append(_format_arg(arg))
    if node.args.posonlyargs:
        parts.append("/")
    for arg in node.args.args:
        parts.append(_format_arg(arg))
    if node.args.vararg:
        parts.append(f"*{_format_arg(node.args.vararg)}")
    elif node.args.kwonlyargs:
        parts.append("*")
    for arg in node.args.kwonlyargs:
        parts.append(_format_arg(arg))
    if node.args.kwarg:
        parts.append(f"**{_format_arg(node.args.kwarg)}")
    signature = f"{node.name}({', '.join(parts)})"
    if node.returns is not None:
        signature = f"{signature} -> {_format_expr(node.returns)}"
    return signature


def format_class_signature(node: ast.AST) -> Optional[str]:
    if not isinstance(node, ast.ClassDef):
        return None
    bases = [_format_expr(base) for base in node.bases if _format_expr(base)]
    if bases:
        return f"{node.name}({', '.join(bases)})"
    return node.name


def _format_arg(arg: ast.arg) -> str:
    if arg.annotation is None:
        return arg.arg
    return f"{arg.arg}: {_format_expr(arg.annotation)}"


def _format_expr(node: ast.AST) -> str:
    try:
        return ast.unparse(node)
    except Exception:
        if isinstance(node, ast.Name):
            return node.id
        if isinstance(node, ast.Attribute):
            return node.attr
        if isinstance(node, ast.Constant):
            return str(node.value)
    return ""


def build_common_metadata(
    file_path: Optional[Path],
    symbol: Optional[str] = None,
    line: Optional[int] = None,
    span: Optional[Dict[str, Any]] = None,
    signature: Optional[str] = None,
    doc_summary: Optional[str] = None,
) -> Dict[str, Any]:
    extra: Dict[str, Any] = {}
    if symbol:
        extra["symbol"] = symbol
    if line:
        extra["line"] = line
    if span:
        extra["span"] = span
    if signature:
        extra["signature"] = signature
    if doc_summary:
        extra["doc_summary"] = doc_summary
    if file_path:
        module = module_from_path(file_path)
        package = package_from_path(file_path)
        if module:
            extra["module"] = module
        if package:
            extra["package"] = package
    return extra


def infer_side_effects(imports: Iterable[str]) -> list[str]:
    modules = {name.split(".")[0] for name in imports if name}
    side_effects: list[str] = []
    if modules & {"sqlalchemy", "sqlite3", "asyncpg", "psycopg", "psycopg2"}:
        side_effects.append("db")
    if modules & {"httpx", "requests", "aiohttp", "urllib", "socket", "grpc"}:
        side_effects.append("network")
    if modules & {"celery", "rq", "dramatiq", "kombu", "queue", "asyncio"}:
        side_effects.append("queue")
    return side_effects
