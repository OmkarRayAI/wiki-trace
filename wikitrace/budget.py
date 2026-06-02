"""Cost budgeting — `wikitrace.budget(usd=10)`.

Subscribes to the span lifecycle hooks, sums ``cost_usd`` from every
``llm_call`` span, and acts when the running total crosses a threshold.

Usage
-----

    import wikitrace
    from wikitrace.budget import budget, BudgetExceeded

    wikitrace.init(pipeline="my-app")
    try:
        with budget(usd=0.05):                     # $0.05 ceiling
            for q in questions:
                answer = chain.invoke({"query": q})
    except BudgetExceeded as e:
        print(f"stopped at ${e.spent:.4f} / ${e.limit:.4f}")
    wikitrace.end()

By default the budget raises when exceeded (CI-friendly). Set
``on_exceed="warn"`` to log to stderr and keep going, or ``"silent"``
to record the breach on the span and continue.

Designed for:
- demo scripts that should hard-stop before burning a card
- CI smoke tests that should fail loudly if cost runs away
- batch jobs with a per-run budget cap
- runbook circuit breakers (call ``current_cost()`` in middleware)

NOT a substitute for provider-side billing limits — those still
matter. This is a fast local guardrail, not the source of truth.
"""

from __future__ import annotations

import os
import sys
import threading
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Iterator, Literal

from . import sdk


@dataclass
class BudgetState:
    """Per-budget bookkeeping. Lives on a ContextVar so nested budgets
    track independently and async tasks fork their own counters."""
    limit_usd: float
    on_exceed: Literal["raise", "warn", "silent"]
    spent_usd: float = 0.0
    breached: bool = False
    name: str | None = None
    lock: threading.Lock = field(default_factory=threading.Lock)


class BudgetExceeded(Exception):
    """Raised by `budget()` when the running cost crosses the limit."""

    def __init__(self, spent: float, limit: float, name: str | None = None):
        self.spent = spent
        self.limit = limit
        self.name = name
        super().__init__(
            f"wikitrace budget exceeded: ${spent:.4f} / ${limit:.4f}"
            + (f" ({name})" if name else ""),
        )


# Stack of active budgets. We support nesting so a CI workflow can set
# a global $1 cap and a single test can wrap an inner $0.05 cap.
_active: ContextVar[tuple[BudgetState, ...]] = ContextVar(
    "wikitrace_budgets", default=()
)


def _on_span_end(span: dict) -> None:
    """Hook fired by sdk.py when any span closes. Pull cost off
    llm_call spans only — non-LLM spans don't contribute."""
    if span.get("name") != "llm_call":
        return
    cost = (span.get("attrs") or {}).get("cost_usd")
    if cost is None:
        return
    try:
        cost_f = float(cost)
    except (TypeError, ValueError):
        return
    if cost_f <= 0:
        return
    for state in _active.get():
        with state.lock:
            state.spent_usd += cost_f
            if state.spent_usd > state.limit_usd and not state.breached:
                state.breached = True
                _handle_breach(state)


def _handle_breach(state: BudgetState) -> None:
    name = f" ({state.name})" if state.name else ""
    msg = (
        f"[wikitrace] budget exceeded{name}: "
        f"${state.spent_usd:.4f} / ${state.limit_usd:.4f}"
    )
    if state.on_exceed == "warn":
        if os.environ.get("WIKITRACE_QUIET") != "1":
            print(msg, file=sys.stderr)
    elif state.on_exceed == "raise":
        # Defer the actual raise to the next user-visible touchpoint.
        # Raising from inside an SDK hook would crash the writer thread.
        # current_cost() and check() raise; user code calls those at
        # natural decision points (next iteration of a loop, etc.).
        if os.environ.get("WIKITRACE_QUIET") != "1":
            print(msg, file=sys.stderr)
    # "silent" → just record on the state; user inspects later.


_hook_installed = False
_hook_lock = threading.Lock()


def _ensure_hook() -> None:
    global _hook_installed
    if _hook_installed:
        return
    with _hook_lock:
        if _hook_installed:
            return
        sdk.register_span_end_hook(_on_span_end)
        _hook_installed = True


@contextmanager
def budget(
    usd: float,
    on_exceed: Literal["raise", "warn", "silent"] = "raise",
    name: str | None = None,
) -> Iterator[BudgetState]:
    """Cap LLM spend inside this block.

    The budget tracks every ``llm_call`` span produced by patched
    OpenAI / Anthropic / OpenRouter clients (and any framework adapter
    that records ``cost_usd`` on its llm_call spans).

    Parameters
    ----------
    usd : float
        Hard ceiling in US dollars.
    on_exceed : "raise" | "warn" | "silent"
        - "raise"  (default): the next call to :func:`check` raises
          :class:`BudgetExceeded`. Loops should call :func:`check`
          between iterations to short-circuit cleanly.
        - "warn": log to stderr the first time the limit is crossed
          and let work continue.
        - "silent": just record the breach on the state for later
          inspection (state.breached, state.spent_usd).
    name : str | None
        Optional label that appears in error messages and logs.

    The context manager itself raises :class:`BudgetExceeded` on exit
    when ``on_exceed="raise"`` and a breach occurred — so even loops
    that never call :func:`check` get a clear error at the boundary.
    """
    _ensure_hook()
    state = BudgetState(limit_usd=usd, on_exceed=on_exceed, name=name)
    cur = _active.get()
    token = _active.set(cur + (state,))
    try:
        yield state
    finally:
        _active.reset(token)
        if state.breached and on_exceed == "raise":
            raise BudgetExceeded(state.spent_usd, state.limit_usd, name=state.name)


def current_cost() -> float:
    """Total cost (USD) inside the innermost active budget. 0.0 if no
    budget is active."""
    cur = _active.get()
    return cur[-1].spent_usd if cur else 0.0


def remaining() -> float:
    """How much budget is left in the innermost active budget. inf if
    no budget is active."""
    cur = _active.get()
    if not cur:
        return float("inf")
    s = cur[-1]
    return max(0.0, s.limit_usd - s.spent_usd)


def check() -> None:
    """Raise :class:`BudgetExceeded` if the innermost budget has
    breached AND ``on_exceed="raise"``. Call between loop iterations
    to short-circuit cleanly without waiting for the context exit."""
    cur = _active.get()
    if not cur:
        return
    s = cur[-1]
    if s.breached and s.on_exceed == "raise":
        raise BudgetExceeded(s.spent_usd, s.limit_usd, name=s.name)
