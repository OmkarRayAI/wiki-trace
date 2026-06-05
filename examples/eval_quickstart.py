"""Eval suite + run comparison — no LLM required.

    python examples/eval_quickstart.py
"""

import wikitrace
from wikitrace.evals import Dataset, run_eval, compare_runs
from wikitrace import judges


def main():
    ds = Dataset([
        {"qid": "q1", "input": "what color is the sky?", "expected": ["blue"]},
        {"qid": "q2", "input": "2+2?", "expected": "4"},
        {"qid": "q3", "input": "name two penguins", "expected": ["emperor", "king"]},
    ])

    def agent_v1(q):
        if "sky" in q: return "the sky is blue"
        if "2+2" in q: return "5"               # wrong
        if "penguin" in q: return "emperor"      # missing king

    def agent_v2(q):
        if "sky" in q: return "the sky is blue"
        if "2+2" in q: return "4"               # fixed
        if "penguin" in q: return "emperor and king"  # fixed

    print("Running v1...")
    r1 = run_eval(agent_v1, dataset=ds,
                  judges=[judges.contains_all],
                  name="agent_v1", model="gpt-4o")
    print(f"  pass_rate = {r1.summary['pass_rate']:.2f}")

    print("Running v2...")
    r2 = run_eval(agent_v2, dataset=ds,
                  judges=[judges.contains_all],
                  name="agent_v2", model="gpt-4o-mini")
    print(f"  pass_rate = {r2.summary['pass_rate']:.2f}")

    print("\nDiff:")
    diff = compare_runs(r1, r2)
    diff.print_table()


if __name__ == "__main__":
    main()
