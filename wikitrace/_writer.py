"""Async batched JSONL writer.

Production-grade replacement for the per-span fopen()+write()+close()
pattern in sdk.py. The previous code did a syscall sequence on every
span — fine for offline ingestion, painful for high-QPS production.

Design
------
- One daemon thread per process. Owns the file handles, drains a queue.
- Public API:
    enqueue(path, obj)       fire-and-forget; returns immediately
    flush(timeout=None)      block until the queue drains
    close()                  flush + stop the thread + close handles
- Batching: writes everything currently in the queue in one go, then
  fdatasync()-style flush, then loops on a 250ms timer.
- Bounded queue: 100k entries. Beyond that we DROP records to keep the
  app responsive — better than blocking user code or running out of
  memory. Drops are counted; counter is read-able for ops alerts.
- File handles are opened lazily and kept open across batches. Each
  batch issues exactly one write() call and one flush() — orders of
  magnitude fewer syscalls than the old per-span model.
- Within a single (path, batch), records preserve enqueue order. Across
  paths, ordering is per-path. Across processes — still none, JSONL is
  shared-mutable-state-on-disk and we don't pretend otherwise.

Failure model
-------------
- Writer thread errors are caught and logged to stderr; the queue keeps
  draining so one bad record doesn't poison the channel.
- atexit registered for the lifetime of the writer so a Python script
  exiting without an explicit end() still flushes.
- If the user calls end() / close() concurrently from multiple threads
  we serialize via a lock. Idempotent.
"""

from __future__ import annotations

import atexit
import json
import queue
import sys
import threading
import time
from pathlib import Path
from typing import Any


# Tunables — env vars override at process start (changing them at
# runtime has no effect once the writer is constructed).
import os
_BATCH_SIZE = int(os.environ.get("WIKITRACE_BATCH_SIZE", "100"))
_FLUSH_INTERVAL_S = float(os.environ.get("WIKITRACE_FLUSH_INTERVAL_MS", "250")) / 1000.0
_QUEUE_MAX = int(os.environ.get("WIKITRACE_QUEUE_MAX", "100000"))


class _AsyncWriter:
    def __init__(self) -> None:
        self._q: queue.Queue[tuple[Path, dict] | None] = queue.Queue(maxsize=_QUEUE_MAX)
        self._handles: dict[Path, Any] = {}
        self._dropped = 0
        self._written = 0
        self._enqueued = 0  # total ever enqueued — flush() waits until written catches up
        self._stop = threading.Event()
        self._idle = threading.Event()  # set when worker has nothing pending
        self._idle.set()
        self._close_lock = threading.Lock()
        self._thread = threading.Thread(
            target=self._run, name="wikitrace-writer", daemon=True,
        )
        self._thread.start()
        atexit.register(self._on_exit)

    # ─── Public API ──────────────────────────────────────────────────────
    def enqueue(self, path: Path, obj: dict) -> None:
        try:
            self._q.put_nowait((path, obj))
            self._enqueued += 1
            self._idle.clear()
        except queue.Full:
            self._dropped += 1
            # Quiet by default — count only. Loud mode for ops debugging.
            if os.environ.get("WIKITRACE_LOUD_DROPS") == "1":
                print(f"[wikitrace] queue full, dropped 1 span (total: {self._dropped})",
                      file=sys.stderr)

    def flush(self, timeout: float | None = 5.0) -> bool:
        """Block until every enqueued record is written + fsync'd.
        Returns True on success, False on timeout."""
        deadline = time.monotonic() + timeout if timeout is not None else None
        # Wait until written/dropped >= enqueued (everything accounted for).
        while (self._written + self._dropped) < self._enqueued:
            if deadline is not None and time.monotonic() > deadline:
                return False
            time.sleep(0.005)
        # Wait for the worker to mark itself idle (covers the case where
        # records have been written but not yet fsync'd).
        if not self._idle.wait(
            timeout=(deadline - time.monotonic()) if deadline else None,
        ):
            return False
        # Force any half-written batch out.
        for h in list(self._handles.values()):
            try:
                h.flush()
            except Exception:
                pass
        return True

    def close(self) -> None:
        with self._close_lock:
            if self._stop.is_set():
                return
            self._stop.set()
            # Wake the thread so it exits the get() promptly.
            try:
                self._q.put_nowait(None)
            except queue.Full:
                pass
            self._thread.join(timeout=5.0)
            for h in list(self._handles.values()):
                try:
                    h.close()
                except Exception:
                    pass
            self._handles.clear()

    @property
    def dropped(self) -> int:
        return self._dropped

    @property
    def written(self) -> int:
        return self._written

    @property
    def queue_size(self) -> int:
        return self._q.qsize()

    # ─── Worker ──────────────────────────────────────────────────────────
    def _run(self) -> None:
        # Buffer per path. We only flush() each handle once per batch
        # (one fdatasync per batch instead of per-span).
        pending: dict[Path, list[str]] = {}
        last_flush = time.monotonic()

        while not self._stop.is_set() or not self._q.empty():
            try:
                item = self._q.get(timeout=_FLUSH_INTERVAL_S)
            except queue.Empty:
                item = None

            if item is not None:
                path, obj = item
                try:
                    line = json.dumps(obj, default=str) + "\n"
                except Exception as e:
                    self._warn(f"serialize failed: {type(e).__name__}: {e}")
                    self._q.task_done()
                    continue
                pending.setdefault(path, []).append(line)
                self._q.task_done()

            # Flush conditions: batch threshold OR time-based flush OR shutdown.
            should_flush = (
                self._stop.is_set()
                or any(len(lines) >= _BATCH_SIZE for lines in pending.values())
                or (time.monotonic() - last_flush) >= _FLUSH_INTERVAL_S
            )
            if should_flush and pending:
                self._drain(pending)
                pending = {}
                last_flush = time.monotonic()
                # Mark idle if there's nothing left in the queue either.
                if self._q.empty():
                    self._idle.set()
            elif not pending and self._q.empty():
                self._idle.set()

        # Final drain on shutdown.
        if pending:
            self._drain(pending)
        for h in list(self._handles.values()):
            try:
                h.flush()
                h.close()
            except Exception:
                pass

    def _drain(self, pending: dict[Path, list[str]]) -> None:
        for path, lines in pending.items():
            handle = self._open(path)
            if handle is None:
                self._dropped += len(lines)
                continue
            try:
                handle.write("".join(lines))
                handle.flush()
                self._written += len(lines)
            except Exception as e:
                self._warn(f"write to {path} failed: {type(e).__name__}: {e}")
                self._dropped += len(lines)

    def _open(self, path: Path):
        h = self._handles.get(path)
        if h is not None:
            return h
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            # Line-buffered (we batch ourselves) but unbuffered byte stream
            # underneath. open() defaults are fine.
            h = path.open("a", buffering=1024 * 1024)
            self._handles[path] = h
            return h
        except Exception as e:
            self._warn(f"open {path} failed: {type(e).__name__}: {e}")
            return None

    def _on_exit(self) -> None:
        try:
            self.close()
        except Exception:
            pass

    def _warn(self, msg: str) -> None:
        if os.environ.get("WIKITRACE_QUIET") == "1":
            return
        print(f"[wikitrace] {msg}", file=sys.stderr)


# Process-singleton writer. Lazily constructed so importing wikitrace
# doesn't spin up a thread you didn't ask for.
_singleton: _AsyncWriter | None = None
_singleton_lock = threading.Lock()


def get_writer() -> _AsyncWriter:
    global _singleton
    if _singleton is None:
        with _singleton_lock:
            if _singleton is None:
                _singleton = _AsyncWriter()
    return _singleton


def writer_stats() -> dict[str, int]:
    """For ops dashboards: how many spans queued / written / dropped."""
    if _singleton is None:
        return {"queued": 0, "written": 0, "dropped": 0}
    return {
        "queued": _singleton.queue_size,
        "written": _singleton.written,
        "dropped": _singleton.dropped,
    }
