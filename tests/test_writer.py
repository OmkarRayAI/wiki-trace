"""Async batched writer: correctness under concurrent load.

The earlier smoke ran 10k spans across threads + asyncio. CI keeps
this small (~500 spans) so the suite stays fast — same invariants."""

from __future__ import annotations

import asyncio
import json
import threading
import time
from pathlib import Path

import wikitrace as wt
from wikitrace._writer import writer_stats


def _spans(trace_dir: Path) -> list[dict]:
    p = trace_dir / "spans.jsonl"
    return [json.loads(l) for l in p.read_text().splitlines()] if p.exists() else []


def test_writer_handles_concurrent_load(trace_dir: Path):
    N = 500  # small enough that CI is fast, large enough to exercise batching
    NUM_THREADS = 4
    NUM_TASKS = 4
    PER = N // (NUM_THREADS + NUM_TASKS)

    def thread_work(start_idx: int):
        for i in range(start_idx, start_idx + PER):
            with wt.span("worker_span", i=i, src="t"):
                pass

    async def asyncio_work(start_idx: int):
        for i in range(start_idx, start_idx + PER):
            with wt.span("async_span", i=i, src="a"):
                await asyncio.sleep(0)

    async def main():
        wt.init(pipeline="perf", trace_dir=trace_dir)
        threads = [
            threading.Thread(target=thread_work, args=(i * PER,))
            for i in range(NUM_THREADS)
        ]
        for t in threads:
            t.start()
        await asyncio.gather(
            *[asyncio_work(NUM_THREADS * PER + i * PER) for i in range(NUM_TASKS)],
        )
        for t in threads:
            t.join()
        wt.end(flush_timeout=10.0)

    asyncio.run(main())

    spans = _spans(trace_dir)
    assert len(spans) == NUM_THREADS * PER + NUM_TASKS * PER
    stats = writer_stats()
    assert stats["dropped"] == 0, f"dropped {stats['dropped']} under load"


def test_writer_flush_is_blocking(trace_dir: Path):
    """end(flush_timeout=...) must block until pending records are
    actually on disk."""
    wt.init(pipeline="t", trace_dir=trace_dir)
    for i in range(20):
        with wt.span("s", i=i):
            pass
    wt.end(flush_timeout=2.0)

    # If end() returned before flush completed, this would race.
    spans = _spans(trace_dir)
    assert len(spans) == 20


def test_writer_preserves_per_span_record_shape(trace_dir: Path):
    """Every recorded span must round-trip to a JSON object with the
    fields the dashboard depends on."""
    required = {"id", "parent_id", "trace_id", "pipeline", "name",
                "start_ts", "end_ts", "attrs", "events", "status"}
    wt.init(pipeline="t", trace_dir=trace_dir)
    with wt.span("a"):
        with wt.span("b"):
            pass
    wt.end()
    for s in _spans(trace_dir):
        missing = required - set(s.keys())
        assert not missing, f"missing {missing} on {s.get('name')}"
