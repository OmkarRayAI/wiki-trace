"""Cost budgeting — hard-cap LLM spend in CI / demos / batch jobs.

    python examples/budget_quickstart.py
"""

import wikitrace
from wikitrace.budget import budget, BudgetExceeded, current_cost, check


def main():
    wikitrace.init(pipeline="budget-demo")
    print("Running with $0.05 cap, on_exceed='raise'...\n")

    try:
        with budget(usd=0.05, name="demo"):
            for i in range(20):
                # Simulate a patched LLM call carrying cost_usd
                with wikitrace.span("llm_call", model="gpt-4o", cost_usd=0.01):
                    pass
                print(f"  iteration {i}: spent ${current_cost():.4f}")
                check()  # short-circuit cleanly between iterations
    except BudgetExceeded as e:
        print(f"\n✓ Budget caught: {e}")

    wikitrace.end()


if __name__ == "__main__":
    main()
