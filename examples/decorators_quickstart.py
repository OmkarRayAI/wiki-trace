"""@trace and @tool decorators — instrument arbitrary functions.

    python examples/decorators_quickstart.py
"""

import asyncio
import wikitrace


@wikitrace.tool(name="search")
def search(query: str) -> list[str]:
    """Pretend retrieval — anything that takes a query and returns chunks."""
    return [f"chunk for {query}", "second chunk"]


@wikitrace.trace(name="answer")
async def answer(question: str) -> str:
    chunks = search(question)
    await asyncio.sleep(0.01)  # pretend the LLM is busy
    return f"Based on {len(chunks)} sources: blue."


async def main():
    wikitrace.init(pipeline="decorators-demo")
    with wikitrace.session(id="run-1"):
        result = await answer("what color is the sky?")
        print(result)
    wikitrace.end()
    print("\n✓ Spans written to .wikitrace/spans.jsonl")


if __name__ == "__main__":
    asyncio.run(main())
