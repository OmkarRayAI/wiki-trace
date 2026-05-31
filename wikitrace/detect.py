"""Citation health detections.

Reads the latest scan trace from .wikitrace/spans.jsonl, checks invariants,
emits a new trace `detect` whose spans are individual detections.

Rules:
    broken_wikilink   — [[name]] doesn't resolve to wiki/<name>.md
    missing_source    — frontmatter source path doesn't exist on disk
    missing_raw_ref   — inline raw/... reference doesn't exist on disk
    orphan_source     — frontmatter source declared but never inlined or
                        otherwise used in body
    stale_page        — a frontmatter source's mtime is newer than the page
"""

from __future__ import annotations

from pathlib import Path

from . import sdk, scan


def run(repo_root: Path, trace_dir: Path) -> tuple[str, list[dict]]:
    index = scan.collect_pages_index(trace_dir)
    pages = index["pages"]
    raw_files = index["raw"]

    # Build lookups.
    page_slugs = {Path(p["page"]).stem for p in pages}
    raw_by_path = {f["path"]: f for f in raw_files}
    page_by_path = {p["page"]: p for p in pages}

    findings: list[dict] = []

    sdk.init(pipeline="detect", trace_dir=str(trace_dir),
             attrs={"page_count": len(pages)})

    with sdk.span("detect"):
        for page in pages:
            rel = page["page"]
            page_mtime = page.get("mtime", 0)
            sources = page.get("declared_sources", []) or []
            audience = page.get("audience")
            cites = page.get("events", [])

            # In-body targets, by kind.
            body_raw = {c["source"] for c in cites
                        if c.get("range") and c.get("claim") == "raw_ref"}
            body_wikilinks = {c["source"] for c in cites
                              if c.get("range") and c.get("claim") == "wikilink"}
            body_wiki = {c["source"] for c in cites
                         if c.get("range") and c.get("claim") == "wiki_ref"}

            # unscoped_page: no audience tag AND no PDF / .md raw source ->
            # likely an internal note polluting the customer-facing wiki.
            if not audience:
                cites_pdf = any(s.endswith(".pdf") for s in sources + list(body_raw))
                cites_raw_md = any(
                    s.endswith(".md") and not s.startswith(("http://", "https://"))
                    for s in sources
                )
                if not cites_pdf and not cites_raw_md:
                    f = _emit("unscoped_page", page=rel, target="audience",
                              detail="page has no audience tag and cites no source documents — "
                                     "may be an internal note in the customer-facing wiki")
                    findings.append(f)

            # broken_wikilink
            for target in sorted(body_wikilinks):
                if target not in page_slugs:
                    f = _emit("broken_wikilink", page=rel, target=target,
                              detail=f"[[{target}]] does not resolve to a wiki page")
                    findings.append(f)

            # missing_source (frontmatter)
            for src in sources:
                if src.startswith(("http://", "https://")):
                    # External URL — skip filesystem checks; orphan check
                    # handled below by ignoring it.
                    continue
                if not (Path(repo_root) / src).exists():
                    f = _emit("missing_source", page=rel, target=src,
                              detail=f"frontmatter source '{src}' not found on disk")
                    findings.append(f)
                else:
                    # stale_page: any source mtime > page mtime
                    src_path = Path(repo_root) / src
                    src_mtime = src_path.stat().st_mtime
                    if src_mtime > page_mtime + 1:  # 1s tolerance
                        f = _emit("stale_page", page=rel, target=src,
                                  detail=f"source '{src}' updated after page "
                                         f"(Δ={src_mtime - page_mtime:.0f}s)",
                                  page_mtime=page_mtime, source_mtime=src_mtime)
                        findings.append(f)

            # missing_raw_ref (inline)
            for target in sorted(body_raw):
                if not (Path(repo_root) / target).exists():
                    f = _emit("missing_raw_ref", page=rel, target=target,
                              detail=f"inline ref '{target}' not found on disk")
                    findings.append(f)

            # missing wiki/ ref
            for target in sorted(body_wiki):
                if not (Path(repo_root) / target).exists():
                    f = _emit("missing_wiki_ref", page=rel, target=target,
                              detail=f"inline ref '{target}' not found on disk")
                    findings.append(f)

            # orphan_source: declared in frontmatter, not referenced in body
            #   and not implicitly used as the only source (single-source pages OK).
            if len(sources) > 1:
                for src in sources:
                    if src.startswith(("http://", "https://")):
                        continue
                    if src in body_raw or src in body_wiki:
                        continue
                    base = Path(src).name
                    if any(base in r for r in body_raw):
                        continue
                    f = _emit("orphan_source", page=rel, target=src,
                              detail=f"source '{src}' declared but not "
                                     f"cited in body")
                    findings.append(f)

    trace_id = sdk.current_trace_id()
    sdk.end()
    return trace_id, findings


def _emit(rule: str, **attrs) -> dict:
    """Open and immediately close a finding span; return a copy of its attrs."""
    with sdk.span(f"finding:{rule}", rule=rule, **attrs) as s:
        pass
    return {"rule": rule, **attrs}
