"""Stdlib http.server dashboard.

Routes:
    /              -> Pages list (citation count, last updated, alert badge)
    /page/<rel>    -> Page lineage: declared sources, citations, alerts
    /sources       -> Raw sources, mtime, fan-in to pages
    /detections    -> All findings, grouped by rule
    /traces        -> List of traces
    /trace/<id>    -> Span tree for one trace

No JS. One CSS block. JSONL is the source of truth — read on every request.
"""

from __future__ import annotations

import html
import json
import urllib.parse
from collections import defaultdict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from . import eval_ingest, scan


CSS = """
* { box-sizing: border-box; }
body { font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
       max-width: 1100px; margin: 0 auto; padding: 24px; color: #1a1a1a; }
header { display: flex; align-items: baseline; gap: 24px; border-bottom: 1px solid #e0e0e0;
         padding-bottom: 12px; margin-bottom: 24px; }
header h1 { font-size: 18px; margin: 0; font-weight: 600; }
header nav a { margin-right: 16px; color: #555; text-decoration: none; }
header nav a:hover, header nav a.active { color: #c2410c; }
h2 { font-size: 16px; margin-top: 32px; }
h3 { font-size: 14px; color: #555; margin-top: 24px; }
table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 13px; }
th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #f0f0f0; vertical-align: top; }
th { font-weight: 600; color: #555; background: #fafafa; }
tr:hover td { background: #fcfaf6; }
a { color: #c2410c; }
.badge { display: inline-block; padding: 1px 6px; border-radius: 3px;
         font-size: 11px; font-weight: 500; }
.badge-ok { background: #ecfdf5; color: #047857; }
.badge-warn { background: #fef3c7; color: #92400e; }
.badge-err { background: #fee2e2; color: #991b1b; }
.badge-muted { background: #f3f4f6; color: #4b5563; }
code, .mono { font-family: ui-monospace, Menlo, monospace; font-size: 12.5px; }
.dim { color: #888; }
.pill { display: inline-block; padding: 0 6px; background: #f3f4f6;
        border-radius: 3px; margin-right: 4px; font-size: 12px; }
.tree { font-family: ui-monospace, Menlo, monospace; font-size: 12.5px;
        white-space: pre; }
.tree-row { display: block; padding: 1px 4px; }
.tree-row:hover { background: #fcfaf6; }
.kv { display: grid; grid-template-columns: 140px 1fr; gap: 4px 16px;
      font-size: 13px; margin: 8px 0; }
.kv dt { color: #666; }
.kv dd { margin: 0; }
.empty { color: #888; font-style: italic; padding: 24px 0; text-align: center; }
.rule { font-family: ui-monospace, Menlo, monospace; font-size: 12px;
        background: #fef3c7; padding: 1px 5px; border-radius: 3px; color: #92400e; }
.rule-err { background: #fee2e2; color: #991b1b; }
"""

NAV_ITEMS = [
    ("/", "Pages"),
    ("/sources", "Sources"),
    ("/detections", "Detections"),
    ("/evals", "Evals"),
    ("/traces", "Traces"),
]


def _layout(title: str, body: str, active: str) -> str:
    parts = []
    for href, label in NAV_ITEMS:
        cls = ' class="active"' if href == active else ''
        parts.append(f'<a href="{href}"{cls}>{label}</a>')
    nav = "".join(parts)
    return f"""<!doctype html><html><head><meta charset="utf-8">
<title>{html.escape(title)} — wikitrace</title>
<style>{CSS}</style></head><body>
<header>
<h1>wikitrace</h1>
<nav>{nav}</nav>
</header>
{body}
</body></html>"""


def _read_jsonl(path: Path):
    if not path.exists():
        return []
    return [json.loads(l) for l in path.read_text().splitlines() if l.strip()]


def _findings_for(repo_root: Path, trace_dir: Path) -> list[dict]:
    """Pull most recent detect trace's findings."""
    spans = _read_jsonl(trace_dir / "spans.jsonl")
    # Find latest detect root span.
    detect_trace_id = None
    for s in reversed(spans):
        if s.get("name") == "detect":
            detect_trace_id = s["trace_id"]
            break
    if not detect_trace_id:
        return []
    return [s for s in spans
            if s["trace_id"] == detect_trace_id and s["name"].startswith("finding:")]


def _badge_for_findings(rules: list[str]) -> str:
    if not rules:
        return '<span class="badge badge-ok">ok</span>'
    err_rules = {"broken_wikilink", "missing_source", "missing_raw_ref",
                 "missing_wiki_ref"}
    cls = "badge-err" if any(r in err_rules for r in rules) else "badge-warn"
    return f'<span class="badge {cls}">{len(rules)}</span>'


def render_pages(repo_root: Path, trace_dir: Path) -> str:
    idx = scan.collect_pages_index(trace_dir)
    findings = _findings_for(repo_root, trace_dir)
    by_page: dict[str, list[str]] = defaultdict(list)
    for f in findings:
        by_page[f["attrs"].get("page", "")].append(f["attrs"]["rule"])

    if not idx["pages"]:
        body = '<p class="empty">No scan yet. Run <code>python -m wikitrace scan</code>.</p>'
        return _layout("Pages", body, "/")

    rows = []
    for p in sorted(idx["pages"], key=lambda x: x["page"]):
        rel = p["page"]
        rules = by_page.get(rel, [])
        rows.append(f"""<tr>
<td><a href="/page/{urllib.parse.quote(rel)}"><code>{html.escape(rel)}</code></a></td>
<td>{html.escape(p.get('title') or '')}</td>
<td><span class="pill">{html.escape(p.get('page_type') or '?')}</span></td>
<td class="mono dim">{len(p.get('declared_sources') or [])}</td>
<td class="mono dim">{p.get('citation_count', 0)}</td>
<td>{_badge_for_findings(rules)}</td>
<td class="mono dim">{html.escape(p.get('updated') or '')}</td>
</tr>""")

    body = f"""
<p class="dim">{len(idx['pages'])} pages · {len(idx['raw'])} raw files
· trace <code>{idx['trace_id'] or '—'}</code></p>
<table>
<thead><tr><th>Page</th><th>Title</th><th>Type</th><th>Sources</th>
<th>Cites</th><th>Health</th><th>Updated</th></tr></thead>
<tbody>{''.join(rows)}</tbody></table>"""
    return _layout("Pages", body, "/")


def render_page(repo_root: Path, trace_dir: Path, rel: str) -> str:
    idx = scan.collect_pages_index(trace_dir)
    page = next((p for p in idx["pages"] if p["page"] == rel), None)
    if not page:
        return _layout(rel, '<p class="empty">Page not in index.</p>', "/")

    findings = [f for f in _findings_for(repo_root, trace_dir)
                if f["attrs"].get("page") == rel]

    sources_html = "".join(
        f'<li><code>{html.escape(s)}</code> '
        f'{"" if (Path(repo_root)/s).exists() else _badge("missing", "err")}</li>'
        for s in (page.get("declared_sources") or [])
    ) or '<li class="dim">none declared</li>'

    cites = page.get("events", [])
    inbound_cites = [c for c in cites if c.get("range")]
    cite_rows = []
    for c in inbound_cites:
        kind = c.get("claim") or "?"
        target = c.get("source", "")
        if kind == "wikilink":
            link = f'<a href="/page/wiki/{urllib.parse.quote(target)}.md">[[{html.escape(target)}]]</a>'
        elif kind == "wiki_ref":
            link = f'<a href="/page/{urllib.parse.quote(target)}"><code>{html.escape(target)}</code></a>'
        else:
            link = f'<code>{html.escape(target)}</code>'
        rng = c.get("range")
        cite_rows.append(
            f'<tr><td><span class="pill">{kind}</span></td><td>{link}</td>'
            f'<td class="mono dim">{rng[0]}–{rng[1]}</td></tr>'
        )

    contrib = eval_ingest.collect_page_contribution(trace_dir).get(rel)
    contrib_html = ""
    if contrib:
        cells = contrib["cells"]
        correct = contrib["correct_cells"]
        pct = 100 * correct / cells if cells else 0
        cls = "badge-ok" if pct >= 80 else ("badge-warn" if pct >= 50 else "badge-err")
        qids_html = " ".join(
            f'<span class="pill">{html.escape(q)}</span>'
            for q in contrib["qids"]
        )
        contrib_html = f"""
<h3>Eval contribution</h3>
<dl class="kv">
<dt>cited in</dt><dd><span class="badge {cls}">{correct}/{cells} cells fully correct</span></dd>
<dt>questions</dt><dd>{qids_html}</dd>
<dt>agents</dt><dd>{', '.join(html.escape(a) for a in contrib['agents'])}</dd>
</dl>
"""

    findings_html = ""
    if findings:
        rows = []
        for f in findings:
            attrs = f["attrs"]
            rule_cls = "rule-err" if attrs["rule"] in {
                "broken_wikilink", "missing_source", "missing_raw_ref",
                "missing_wiki_ref"} else ""
            rows.append(
                f'<tr><td><span class="rule {rule_cls}">{attrs["rule"]}</span></td>'
                f'<td><code>{html.escape(attrs.get("target") or "")}</code></td>'
                f'<td>{html.escape(attrs.get("detail") or "")}</td></tr>'
            )
        findings_html = f"""
<h2>Detections ({len(findings)})</h2>
<table><thead><tr><th>Rule</th><th>Target</th><th>Detail</th></tr></thead>
<tbody>{''.join(rows)}</tbody></table>"""

    body = f"""
<p class="dim"><a href="/">← Pages</a></p>
<h2><code>{html.escape(rel)}</code></h2>
<dl class="kv">
<dt>title</dt><dd>{html.escape(page.get('title') or '—')}</dd>
<dt>type</dt><dd>{html.escape(page.get('page_type') or '—')}</dd>
<dt>updated</dt><dd>{html.escape(page.get('updated') or '—')}</dd>
<dt>size</dt><dd class="mono">{page.get('size', 0)} bytes</dd>
<dt>citations</dt><dd class="mono">{page.get('citation_count', 0)}</dd>
</dl>

<h3>Declared sources (frontmatter)</h3>
<ul>{sources_html}</ul>

<h3>In-body citations ({len(inbound_cites)})</h3>
<table><thead><tr><th>Kind</th><th>Target</th><th>Range</th></tr></thead>
<tbody>{''.join(cite_rows) or '<tr><td colspan=3 class="dim">none</td></tr>'}</tbody></table>

{contrib_html}
{findings_html}
"""
    return _layout(rel, body, "/")


def render_sources(repo_root: Path, trace_dir: Path) -> str:
    idx = scan.collect_pages_index(trace_dir)
    # Build fan-in: source -> list of pages that cite or declare it.
    fanin: dict[str, set[str]] = defaultdict(set)
    for p in idx["pages"]:
        for s in p.get("declared_sources") or []:
            fanin[s].add(p["page"])
        for c in p.get("events", []):
            if c.get("range") and c.get("source"):
                fanin[c["source"]].add(p["page"])

    rows = []
    for r in sorted(idx["raw"], key=lambda x: x["path"]):
        consumers = sorted(fanin.get(r["path"], []))
        consumers_html = " ".join(
            f'<a href="/page/{urllib.parse.quote(c)}"><code>{html.escape(Path(c).stem)}</code></a>'
            for c in consumers) or '<span class="dim">orphan</span>'
        rows.append(
            f'<tr><td><code>{html.escape(r["path"])}</code></td>'
            f'<td class="mono dim">{r["size"]:,}</td>'
            f'<td>{consumers_html}</td></tr>'
        )

    body = f"""
<p class="dim">{len(idx['raw'])} raw files</p>
<table><thead><tr><th>Path</th><th>Size</th><th>Cited by</th></tr></thead>
<tbody>{''.join(rows)}</tbody></table>"""
    return _layout("Sources", body, "/sources")


def render_detections(repo_root: Path, trace_dir: Path) -> str:
    findings = _findings_for(repo_root, trace_dir)
    if not findings:
        body = '<p class="empty">No detections. Run <code>python -m wikitrace detect</code>.</p>'
        return _layout("Detections", body, "/detections")

    by_rule: dict[str, list[dict]] = defaultdict(list)
    for f in findings:
        by_rule[f["attrs"]["rule"]].append(f)

    sections = []
    err_rules = {"broken_wikilink", "missing_source", "missing_raw_ref",
                 "missing_wiki_ref"}
    for rule in sorted(by_rule, key=lambda r: (r not in err_rules, r)):
        items = by_rule[rule]
        rule_cls = "rule-err" if rule in err_rules else ""
        rows = []
        for f in items:
            a = f["attrs"]
            page = a.get("page", "")
            rows.append(
                f'<tr><td><a href="/page/{urllib.parse.quote(page)}">'
                f'<code>{html.escape(page)}</code></a></td>'
                f'<td><code>{html.escape(a.get("target") or "")}</code></td>'
                f'<td>{html.escape(a.get("detail") or "")}</td></tr>'
            )
        sections.append(f"""
<h2><span class="rule {rule_cls}">{rule}</span> <span class="dim">({len(items)})</span></h2>
<table><thead><tr><th>Page</th><th>Target</th><th>Detail</th></tr></thead>
<tbody>{''.join(rows)}</tbody></table>""")

    body = f'<p class="dim">{len(findings)} findings across {len(by_rule)} rules</p>' + "".join(sections)
    return _layout("Detections", body, "/detections")


def render_evals(trace_dir: Path) -> str:
    runs = eval_ingest.collect_evals_index(trace_dir)
    contrib = eval_ingest.collect_page_contribution(trace_dir)
    if not runs:
        body = ('<p class="empty">No eval runs ingested yet. '
                'Run <code>python -m wikitrace ingest-evals</code>.</p>')
        return _layout("Evals", body, "/evals")

    # Aggregate wiki vs RAG headline pass rate across all runs.
    headline_rows = []
    for r in runs:
        cells = []
        for key, val in sorted(r["summary"].items()):
            agent, model = key.split("/", 1)
            try:
                c, t = val.split("/")
                pct = 100 * int(c) / int(t) if int(t) else 0
            except Exception:
                pct = 0
            cls = "badge-ok" if pct >= 80 else ("badge-warn" if pct >= 50 else "badge-err")
            cells.append(
                f'<span class="pill" title="{html.escape(key)}">'
                f'<b>{html.escape(agent)}</b>·{html.escape(model)} '
                f'<span class="badge {cls}">{html.escape(val)}</span></span>'
            )
        headline_rows.append(
            f'<tr><td><a href="/evals/{html.escape(r["run_id"])}">'
            f'<code>{html.escape(r["run_id"])}</code></a></td>'
            f'<td class="mono dim">{r["row_count"]}</td>'
            f'<td>{" ".join(cells)}</td></tr>'
        )

    contrib_rows = []
    for path, slot in sorted(contrib.items(),
                             key=lambda kv: -kv[1]["cells"]):
        cells = slot["cells"]
        correct = slot["correct_cells"]
        pct = 100 * correct / cells if cells else 0
        cls = "badge-ok" if pct >= 80 else ("badge-warn" if pct >= 50 else "badge-err")
        contrib_rows.append(
            f'<tr><td><a href="/page/{urllib.parse.quote(path)}">'
            f'<code>{html.escape(path)}</code></a></td>'
            f'<td class="mono dim">{cells}</td>'
            f'<td><span class="badge {cls}">{correct}/{cells}</span></td>'
            f'<td class="mono dim">{len(slot["qids"])} qids · {len(slot["agents"])} agents</td></tr>'
        )

    contrib_html = ""
    if contrib_rows:
        contrib_html = f"""
<h2>Wiki page contribution</h2>
<p class="dim">Each row: how many eval cells cited this page in their answer,
and how many of those cells were fully correct.</p>
<table><thead><tr><th>Page</th><th>Cells</th><th>Fully correct</th><th>Coverage</th></tr></thead>
<tbody>{''.join(contrib_rows)}</tbody></table>"""

    body = f"""
<h2>Eval runs</h2>
<table><thead><tr><th>Run</th><th>Rows</th><th>Pass rate</th></tr></thead>
<tbody>{''.join(headline_rows)}</tbody></table>
{contrib_html}
"""
    return _layout("Evals", body, "/evals")


def render_eval_run(trace_dir: Path, run_id: str) -> str:
    detail = eval_ingest.collect_run_detail(trace_dir, run_id)
    rows = detail["rows"]
    if not rows:
        return _layout(run_id, '<p class="empty">No rows for this run.</p>', "/evals")

    # Build agent×model matrix.
    pairs = sorted({(r["agent"], r["model"]) for r in rows})
    qids = sorted({r["qid"] for r in rows})
    cell: dict[tuple[str, str], list[dict]] = {p: [] for p in pairs}
    for r in rows:
        cell[(r["agent"], r["model"])].append(r)

    matrix_rows = []
    for (a, m), cells in cell.items():
        c = sum(x["correct"] for x in cells)
        t = sum(x["total"] for x in cells)
        pct = 100 * c / t if t else 0
        cls = "badge-ok" if pct >= 80 else ("badge-warn" if pct >= 50 else "badge-err")
        matrix_rows.append(
            f'<tr><td><b>{html.escape(a)}</b></td><td>{html.escape(m)}</td>'
            f'<td class="mono dim">{len(cells)}</td>'
            f'<td><span class="badge {cls}">{c}/{t} ({pct:.0f}%)</span></td></tr>'
        )

    # Per-question rows: show each agent×model side-by-side.
    per_q_html = []
    for qid in qids:
        qrows = [r for r in rows if r["qid"] == qid]
        question = detail["questions"].get(qid, "")
        cells_html = []
        for r in qrows:
            full = r["correct"] == r["total"] and r["total"] > 0
            cls = "badge-ok" if full else ("badge-warn" if r["correct"] > 0 else "badge-err")
            wiki_pills = " ".join(
                f'<a class="pill" href="/page/{urllib.parse.quote(p)}">'
                f'{html.escape(Path(p).stem)}</a>'
                for p in r.get("wiki_refs") or []
            )
            raw_pills = " ".join(
                f'<span class="pill" title="{html.escape(p)}">{html.escape(Path(p).name)}</span>'
                for p in r.get("raw_refs") or []
            )
            refs_html = wiki_pills + (" " if wiki_pills and raw_pills else "") + raw_pills
            if not refs_html:
                refs_html = '<span class="dim">no refs</span>'
            cells_html.append(
                f'<tr>'
                f'<td><b>{html.escape(r["agent"])}</b> <span class="dim">{html.escape(r["model"])}</span></td>'
                f'<td><span class="badge {cls}">{r["correct"]}/{r["total"]}</span></td>'
                f'<td class="mono dim">{r.get("latency_s") or "—"}s</td>'
                f'<td>{refs_html}</td>'
                f'</tr>'
            )
        per_q_html.append(f"""
<h3>{html.escape(qid)}</h3>
<p class="dim">{html.escape(question)}</p>
<table><thead><tr><th>Agent · Model</th><th>Score</th><th>Latency</th><th>Refs in answer</th></tr></thead>
<tbody>{''.join(cells_html)}</tbody></table>
""")

    body = f"""
<p class="dim"><a href="/evals">← Evals</a> · trace <a href="/trace/{detail['trace_id']}"><code>{detail['trace_id']}</code></a></p>
<h2>Run <code>{html.escape(run_id)}</code></h2>

<h3>Aggregate score</h3>
<table><thead><tr><th>Agent</th><th>Model</th><th>Cells</th><th>Score</th></tr></thead>
<tbody>{''.join(matrix_rows)}</tbody></table>

<h2>Per-question detail</h2>
{''.join(per_q_html)}
"""
    return _layout(run_id, body, "/evals")


def render_traces(trace_dir: Path) -> str:
    traces = _read_jsonl(trace_dir / "traces.jsonl")
    if not traces:
        body = '<p class="empty">No traces yet.</p>'
        return _layout("Traces", body, "/traces")
    rows = []
    for t in reversed(traces):
        dur = (t["end_ts"] - t["start_ts"]) * 1000
        attrs = t.get("attrs") or {}
        attrs_html = " ".join(
            f'<span class="pill">{html.escape(k)}={html.escape(str(v)[:40])}</span>'
            for k, v in attrs.items()
        )
        rows.append(
            f'<tr><td><a href="/trace/{t["trace_id"]}"><code>{t["trace_id"]}</code></a></td>'
            f'<td>{html.escape(t["pipeline"])}</td>'
            f'<td>{_badge(t["status"], "ok" if t["status"] == "ok" else "err")}</td>'
            f'<td class="mono dim">{dur:.0f} ms</td>'
            f'<td>{attrs_html}</td></tr>'
        )
    body = f"""<table><thead><tr><th>ID</th><th>Pipeline</th><th>Status</th>
<th>Duration</th><th>Attrs</th></tr></thead>
<tbody>{''.join(rows)}</tbody></table>"""
    return _layout("Traces", body, "/traces")


def render_trace(trace_dir: Path, trace_id: str) -> str:
    spans = [s for s in _read_jsonl(trace_dir / "spans.jsonl")
             if s["trace_id"] == trace_id]
    if not spans:
        return _layout(trace_id, '<p class="empty">Trace not found.</p>', "/traces")

    by_parent: dict[str | None, list[dict]] = defaultdict(list)
    for s in spans:
        by_parent[s["parent_id"]].append(s)

    out: list[str] = []

    def walk(parent: str | None, depth: int) -> None:
        for s in sorted(by_parent.get(parent, []), key=lambda x: x["start_ts"]):
            dur = (s["end_ts"] - s["start_ts"]) * 1000 if s["end_ts"] else 0
            indent = "  " * depth
            label = s["name"]
            attrs = s.get("attrs") or {}
            short = ""
            for k in ("page", "target", "rule", "count", "root"):
                if k in attrs:
                    short = f' <span class="dim">{html.escape(k)}={html.escape(str(attrs[k])[:60])}</span>'
                    break
            events = s.get("events", [])
            ev = f' <span class="dim">+{len(events)} events</span>' if events else ""
            out.append(
                f'<span class="tree-row">{indent}<b>{html.escape(label)}</b>'
                f'{short}{ev} '
                f'<span class="dim">{dur:.0f}ms</span></span>'
            )
            walk(s["id"], depth + 1)

    walk(None, 0)

    body = f"""
<p class="dim"><a href="/traces">← Traces</a></p>
<h2>Trace <code>{trace_id}</code> <span class="dim">({len(spans)} spans)</span></h2>
<div class="tree">{''.join(out)}</div>"""
    return _layout(f"trace {trace_id}", body, "/traces")


def _badge(label: str, kind: str) -> str:
    return f'<span class="badge badge-{kind}">{html.escape(label)}</span>'


def make_handler(repo_root: Path, trace_dir: Path):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args, **kwargs):
            pass

        def _send(self, status: int, body: str, ctype: str = "text/html; charset=utf-8"):
            data = body.encode("utf-8")
            self.send_response(status)
            self.send_header("content-type", ctype)
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            path = urllib.parse.unquote(self.path.split("?")[0])
            if path == "/":
                return self._send(200, render_pages(repo_root, trace_dir))
            if path.startswith("/page/"):
                rel = path[len("/page/"):]
                return self._send(200, render_page(repo_root, trace_dir, rel))
            if path == "/sources":
                return self._send(200, render_sources(repo_root, trace_dir))
            if path == "/detections":
                return self._send(200, render_detections(repo_root, trace_dir))
            if path == "/evals":
                return self._send(200, render_evals(trace_dir))
            if path.startswith("/evals/"):
                rid = path[len("/evals/"):]
                return self._send(200, render_eval_run(trace_dir, rid))
            if path == "/traces":
                return self._send(200, render_traces(trace_dir))
            if path.startswith("/trace/"):
                tid = path[len("/trace/"):]
                return self._send(200, render_trace(trace_dir, tid))
            self._send(404, _layout("404", '<p class="empty">Not found.</p>', ""))

    return Handler


def serve(repo_root: Path, trace_dir: Path, port: int = 8765) -> None:
    handler = make_handler(repo_root, trace_dir)
    server = ThreadingHTTPServer(("127.0.0.1", port), handler)
    print(f"wikitrace dashboard: http://127.0.0.1:{port}")
    print(f"  repo:      {repo_root}")
    print(f"  trace_dir: {trace_dir}")
    server.serve_forever()
