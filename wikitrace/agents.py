"""Subagent cost rollup at the agent_call level.

When an agent spawns subagents (planner -> tool -> child agent_call ->
... ), the cost data lives on individual ``llm_call`` leaves but no
single span carries the total spend the parent caused. ``tree_cost()``
walks a span's descendants and sums the costs.

This is a Twitter-feedback gap: people asked "does it work for
subagent convos? cost is dictated by those now." The data model
already supports arbitrary nesting via ``parent_id``; this module
surfaces the rollup that the dashboard and Python users actually
need.

Usage::

    from wikitrace.agents import tree_cost, agent_rollups

    # One agent_call, fully recursive cost across all descendants
    rollup = tree_cost(spans, root_span_id="abc1234567890def")
    print(rollup.cost_usd, rollup.input_tokens, rollup.llm_calls)

    # All top-level agent_call spans in a trace dir
    rollups = agent_rollups(trace_dir=".wikitrace")
    for r in rollups:
        print(r.span_id, r.agent, r.cost_usd, r.depth)
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable


@dataclass
class CostRollup:
    """Cost / tokens / structural counts across a span and its
    descendants. ``span_id`` is the root we rolled up from."""
    span_id: str
    trace_id: str
    agent: str | None
    pipeline: str | None
    name: str
    start_ts: float
    end_ts: float | None
    status: str
    # Self attrs (for context, not summed).
    self_attrs: dict = field(default_factory=dict)
    # Rolled-up totals across the subtree.
    cost_usd: float = 0.0
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    # Structural counts: how many of each interesting child kind appear
    # below this root.
    descendants: int = 0
    llm_calls: int = 0
    tool_calls: int = 0
    agent_calls: int = 0  # NESTED agent_calls (subagents) below this root
    errors: int = 0
    # Tree depth (distance from root to deepest leaf).
    depth: int = 0
    # Latency: end_ts - start_ts on the root span itself, in ms. The
    # subtree's latency is bounded by the root because spans nest in time.
    latency_ms: int | None = None


def _children_index(spans: list[dict]) -> dict[str | None, list[dict]]:
    out: dict[str | None, list[dict]] = {}
    for s in spans:
        out.setdefault(s.get("parent_id"), []).append(s)
    return out


def tree_cost(spans: Iterable[dict], root_span_id: str) -> CostRollup | None:
    """Walk all descendants of ``root_span_id`` (inclusive) and sum
    cost / tokens / structural counts. Returns ``None`` if the root
    span isn't in ``spans``.

    This is pure: pass any iterable of span dicts (loaded from
    ``spans.jsonl``, fetched from the cloud server, anything matching
    the wikitrace shape). Cost / tokens are summed from each span's
    ``attrs.cost_usd``, ``input_tokens``, ``output_tokens``, ``total_tokens``
    when present. Spans without these attrs contribute structurally
    (descendant count, depth) but not to cost.
    """
    span_list = list(spans)
    by_id = {s["id"]: s for s in span_list}
    root = by_id.get(root_span_id)
    if root is None:
        return None

    children_of = _children_index(span_list)

    rollup = CostRollup(
        span_id=root["id"],
        trace_id=root.get("trace_id", ""),
        agent=(root.get("attrs") or {}).get("agent"),
        pipeline=root.get("pipeline"),
        name=root.get("name", ""),
        start_ts=float(root.get("start_ts") or 0),
        end_ts=root.get("end_ts"),
        status=root.get("status", "ok"),
        self_attrs=dict(root.get("attrs") or {}),
    )
    if rollup.end_ts is not None and rollup.start_ts is not None:
        rollup.latency_ms = int((rollup.end_ts - rollup.start_ts) * 1000)

    # BFS from root, summing as we go. Track depth.
    queue: list[tuple[dict, int]] = [(root, 0)]
    while queue:
        node, depth = queue.pop(0)
        a = node.get("attrs") or {}
        # Sum cost / tokens. None and missing both treated as 0.
        for src, dst in (
            ("cost_usd", "cost_usd"),
            ("input_tokens", "input_tokens"),
            ("output_tokens", "output_tokens"),
            ("total_tokens", "total_tokens"),
        ):
            v = a.get(src)
            if v is None:
                continue
            try:
                if dst == "cost_usd":
                    rollup.cost_usd += float(v)
                else:
                    setattr(rollup, dst, getattr(rollup, dst) + int(v))
            except (TypeError, ValueError):
                pass

        # Count by kind. Don't double-count the root.
        if node["id"] != root_span_id:
            rollup.descendants += 1
            kind = node.get("name", "")
            if kind == "llm_call":
                rollup.llm_calls += 1
            elif kind == "tool_call":
                rollup.tool_calls += 1
            elif kind == "agent_call":
                rollup.agent_calls += 1

        if node.get("status") == "error":
            rollup.errors += 1

        rollup.depth = max(rollup.depth, depth)

        for child in children_of.get(node["id"], []):
            queue.append((child, depth + 1))

    return rollup


def agent_rollups(
    *,
    trace_dir: str | Path = ".wikitrace",
    only_top_level: bool = True,
    limit: int | None = None,
) -> list[CostRollup]:
    """Compute :class:`CostRollup` for every ``agent_call`` span in a
    trace directory.

    Parameters
    ----------
    trace_dir
        Directory containing ``spans.jsonl``.
    only_top_level
        When True (default), only roll up agent_call spans whose
        parent is None or whose parent is itself NOT an agent_call.
        This is the typical "what did each user-visible agent run
        cost end-to-end" view. Set to False to also produce rollups
        for nested subagents (every agent_call gets its own row).
    limit
        Max number of rollups to return, most recent first.
    """
    p = Path(trace_dir) / "spans.jsonl"
    if not p.exists():
        return []
    spans = [json.loads(l) for l in p.read_text().splitlines() if l.strip()]
    by_id = {s["id"]: s for s in spans}

    roots: list[dict] = []
    for s in spans:
        if s.get("name") != "agent_call":
            continue
        if only_top_level:
            parent = by_id.get(s.get("parent_id") or "")
            if parent is not None and parent.get("name") == "agent_call":
                continue  # this is a nested subagent; skip
        roots.append(s)

    rollups: list[CostRollup] = []
    for root in roots:
        r = tree_cost(spans, root["id"])
        if r is not None:
            rollups.append(r)

    # Most recent first — useful default for the dashboard list view.
    rollups.sort(key=lambda r: r.start_ts, reverse=True)
    if limit is not None:
        rollups = rollups[:limit]
    return rollups
