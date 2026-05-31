"""Scan the repo and emit a trace describing wiki state.

For each wiki/*.md page we record:
    - sources declared in frontmatter
    - inline raw/ references (markdown links + bare paths)
    - [[wikilinks]]
    - mtime, size, citation count

Each page becomes a `scan_page` span. cite() events record every
citation found. The whole scan is one trace.
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Iterable

from . import sdk

# `[[wikilink]]` — capture the slug, ignoring anchors / aliases for now.
WIKILINK_RE = re.compile(r"\[\[([^\]\|#]+)(?:#[^\]\|]+)?(?:\|[^\]]+)?\]\]")
# Inline references to raw/... paths, with or without markdown link syntax.
RAW_REF_RE = re.compile(r"`?(raw/[A-Za-z0-9._\-/]+\.(?:md|pdf))`?")
# Backtick path to a wiki page.
WIKI_REF_RE = re.compile(r"`?(wiki/[A-Za-z0-9._\-/]+\.md)`?")


def _read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return path.read_text(encoding="utf-8", errors="replace")


def parse_frontmatter(text: str) -> tuple[dict, int]:
    """Return (frontmatter_dict, body_offset). Minimal YAML-ish parser:
    only handles `key: value` and `key:` followed by `  - item` lists.
    Sufficient for this repo's frontmatter style."""
    if not text.startswith("---\n"):
        return {}, 0
    end = text.find("\n---\n", 4)
    if end == -1:
        return {}, 0
    fm_text = text[4:end]
    body_offset = end + len("\n---\n")
    fm: dict = {}
    current_list_key: str | None = None
    for line in fm_text.splitlines():
        if not line.strip():
            current_list_key = None
            continue
        if line.startswith("  - "):
            if current_list_key is not None:
                fm.setdefault(current_list_key, []).append(line[4:].strip())
            continue
        m = re.match(r"^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$", line)
        if not m:
            current_list_key = None
            continue
        key, val = m.group(1), m.group(2).strip()
        if not val:
            current_list_key = key
            fm[key] = []
        else:
            current_list_key = None
            # inline list `[a, b, c]`
            if val.startswith("[") and val.endswith("]"):
                items = [x.strip() for x in val[1:-1].split(",") if x.strip()]
                fm[key] = items
            else:
                fm[key] = val
    return fm, body_offset


def _strip_code_spans(text: str) -> str:
    """Replace fenced code blocks (```...```) with spaces of equal length, so
    byte offsets are preserved but matches inside fenced code don't fire.

    We deliberately do NOT mask single-backtick inline code: in this wiki
    convention, paths are cited as `raw/foo.pdf` or `wiki/foo.md` precisely
    because backticks are the canonical formatting for paths in markdown.
    Treating them as non-citations would erase most of the body references.
    """
    out = list(text)
    i = 0
    n = len(text)
    while i < n:
        if text.startswith("```", i):
            j = text.find("```", i + 3)
            if j == -1:
                j = n
            else:
                j += 3
            for k in range(i, j):
                if out[k] != "\n":
                    out[k] = " "
            i = j
            continue
        i += 1
    return "".join(out)


def _is_inside_inline_backtick(text: str, start: int, end: int) -> bool:
    """True if the [start, end) span is wrapped by single backticks on the same
    line. Used only for [[wikilinks]] — for raw/... and wiki/... refs we WANT
    to count the backticked form (canonical path formatting in markdown)."""
    line_start = text.rfind("\n", 0, start) + 1
    line_end = text.find("\n", end)
    if line_end == -1:
        line_end = len(text)
    line = text[line_start:line_end]
    rel_start = start - line_start
    rel_end = end - line_start
    pre_backticks = line[:rel_start].count("`")
    post_backticks = line[rel_end:].count("`")
    # If there's an odd backtick before AND an odd backtick after on the same
    # line, we're inside an inline-code span.
    return pre_backticks % 2 == 1 and post_backticks % 2 == 1


def find_citations(text: str, body_offset: int) -> list[dict]:
    """Find inline raw/... and wiki/... refs and [[wikilinks]] with byte ranges.

    Fenced code blocks are masked (those are usually examples). Single-backtick
    inline code is NOT masked for raw/... and wiki/... refs (backticks are how
    paths are conventionally cited in markdown), but IS masked for [[wikilinks]]
    (because `[[links]]` in prose is usually metalinguistic — explaining syntax)."""
    masked = _strip_code_spans(text)
    out: list[dict] = []
    for m in RAW_REF_RE.finditer(masked, body_offset):
        out.append({
            "kind": "raw_ref",
            "target": m.group(1),
            "range": [m.start(), m.end()],
        })
    for m in WIKI_REF_RE.finditer(masked, body_offset):
        out.append({
            "kind": "wiki_ref",
            "target": m.group(1),
            "range": [m.start(), m.end()],
        })
    for m in WIKILINK_RE.finditer(masked, body_offset):
        if _is_inside_inline_backtick(masked, m.start(), m.end()):
            continue
        out.append({
            "kind": "wikilink",
            "target": m.group(1).strip(),
            "range": [m.start(), m.end()],
        })
    return out


def scan_repo(repo_root: Path, trace_dir: Path) -> str:
    """Scan repo_root, emit one trace into trace_dir. Returns trace_id."""
    wiki_dir = repo_root / "wiki"
    raw_dir = repo_root / "raw"
    pages = sorted(wiki_dir.glob("*.md")) if wiki_dir.exists() else []
    raw_files = sorted(p for p in raw_dir.rglob("*") if p.is_file()) if raw_dir.exists() else []

    trace_id = sdk.init(
        pipeline="scan",
        trace_dir=str(trace_dir),
        attrs={"repo_root": str(repo_root), "page_count": len(pages),
               "raw_count": len(raw_files)},
    )

    with sdk.span("scan", root=str(repo_root)):
        with sdk.span("index_raw", count=len(raw_files)) as r:
            r["attrs"]["files"] = [
                {"path": str(p.relative_to(repo_root)),
                 "size": p.stat().st_size,
                 "mtime": p.stat().st_mtime}
                for p in raw_files
            ]

        for page in pages:
            rel = str(page.relative_to(repo_root))
            text = _read(page)
            fm, body_offset = parse_frontmatter(text)
            sources = fm.get("sources", []) or []
            cites = find_citations(text, body_offset)
            stat = page.stat()
            with sdk.span("scan_page",
                          page=rel,
                          title=fm.get("title"),
                          page_type=fm.get("type"),
                          audience=fm.get("audience"),
                          folder=fm.get("folder"),
                          updated=fm.get("updated"),
                          size=stat.st_size,
                          mtime=stat.st_mtime,
                          declared_sources=sources,
                          citation_count=len(cites)):
                for src in sources:
                    sdk.cite(source=src, claim=f"declared in frontmatter of {rel}")
                for c in cites:
                    sdk.cite(source=c["target"], range=c["range"],
                             claim=c["kind"])

    sdk.end()
    return trace_id


def collect_pages_index(trace_dir: Path) -> dict:
    """Read spans.jsonl, return data from the most recent scan trace.

    Spans are written in close-order, so children land before parents.
    Pass 1: find the latest trace_id whose pipeline is 'scan'. Pass 2:
    collect all matching spans.
    """
    import json
    spans_path = trace_dir / "spans.jsonl"
    if not spans_path.exists():
        return {"pages": [], "raw": [], "trace_id": None}
    records = [json.loads(l) for l in spans_path.read_text().splitlines() if l.strip()]
    scan_trace_id: str | None = None
    for rec in reversed(records):
        if rec.get("pipeline") == "scan":
            scan_trace_id = rec["trace_id"]
            break
    if not scan_trace_id:
        return {"pages": [], "raw": [], "trace_id": None}
    pages: dict[str, dict] = {}
    raw: list[dict] = []
    for rec in records:
        if rec.get("trace_id") != scan_trace_id:
            continue
        if rec.get("name") == "scan_page":
            attrs = rec["attrs"]
            pages[attrs["page"]] = {
                **attrs,
                "events": rec.get("events", []),
                "span_id": rec["id"],
            }
        elif rec.get("name") == "index_raw":
            raw = rec["attrs"].get("files", [])
    return {"pages": list(pages.values()), "raw": raw, "trace_id": scan_trace_id}
