"""CLI: python -m wikitrace {scan,detect,serve,all}"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import detect, eval_ingest, scan, server


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="wikitrace")
    p.add_argument("--repo", default=".", help="repo root (default: cwd)")
    p.add_argument("--trace-dir", default=".wikitrace",
                   help="where to write traces (default: .wikitrace)")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("scan", help="scan wiki + raw, write a trace")
    sub.add_parser("detect", help="run citation health rules, write a trace")
    sub.add_parser("ingest-evals", help="backfill eval/runs/* into traces")
    sub.add_parser("all", help="scan + detect + ingest-evals")
    s_serve = sub.add_parser("serve", help="run the dashboard")
    s_serve.add_argument("--port", type=int, default=8765)

    args = p.parse_args(argv)
    repo = Path(args.repo).resolve()
    trace_dir = Path(args.trace_dir)
    if not trace_dir.is_absolute():
        trace_dir = repo / trace_dir

    if args.cmd in ("scan", "all"):
        tid = scan.scan_repo(repo, trace_dir)
        print(f"scan trace {tid} -> {trace_dir/'spans.jsonl'}")
    if args.cmd in ("detect", "all"):
        tid, findings = detect.run(repo, trace_dir)
        err = sum(1 for f in findings if f["rule"] in {
            "broken_wikilink", "missing_source", "missing_raw_ref",
            "missing_wiki_ref"})
        warn = len(findings) - err
        print(f"detect trace {tid} -> {len(findings)} findings ({err} err, {warn} warn)")
        for f in findings:
            print(f"  [{f['rule']:20s}] {f.get('page','')}  →  {f.get('target','')}")
    if args.cmd in ("ingest-evals", "all"):
        ids = eval_ingest.ingest_all(repo, trace_dir)
        print(f"ingest-evals: {len(ids)} runs ingested")
        for tid in ids:
            print(f"  trace {tid}")
    if args.cmd == "serve":
        server.serve(repo, trace_dir, port=args.port)
    return 0


if __name__ == "__main__":
    sys.exit(main())
