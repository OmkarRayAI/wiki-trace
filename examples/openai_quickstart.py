"""60-second quickstart: OpenAI + wiki-trace.

Every chat.completions call gets traced — cost, tokens, latency,
streaming events. No code changes besides one patch() line.

    pip install 'wikitrace' openai
    OPENAI_API_KEY=sk-... python examples/openai_quickstart.py

Or run it for free against OpenRouter:

    pip install 'wikitrace' openai
    OPENROUTER_API_KEY=sk-or-... python examples/openai_quickstart.py

After the run, inspect ``.wikitrace/spans.jsonl``:

    cat .wikitrace/spans.jsonl | python -m json.tool
"""

import os
import openai
import wikitrace
import wikitrace.openai


def main():
    # One line: every OpenAI call is now a wiki-trace span.
    wikitrace.openai.patch()

    # Pick OpenRouter (free) or OpenAI based on which key is set.
    if os.getenv("OPENROUTER_API_KEY"):
        client = openai.OpenAI(
            api_key=os.environ["OPENROUTER_API_KEY"],
            base_url="https://openrouter.ai/api/v1",
        )
        model = "liquid/lfm-2.5-1.2b-instruct:free"
    else:
        client = openai.OpenAI()
        model = "gpt-4o-mini"

    wikitrace.init(pipeline="quickstart")
    with wikitrace.session(id="demo-1", user="alice", tags=["example"]):
        # Non-streaming
        resp = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": "what color is the sky?"}],
            max_tokens=20,
        )
        print("Answer:", resp.choices[0].message.content)

        # Streaming — every token becomes a span event
        print("\nStreaming: ", end="", flush=True)
        stream = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": "count to 3"}],
            max_tokens=20,
            stream=True,
        )
        for chunk in stream:
            delta = chunk.choices[0].delta.content if chunk.choices else None
            if delta:
                print(delta, end="", flush=True)
        print()

    wikitrace.end()
    print("\n✓ Spans written to .wikitrace/spans.jsonl")
    print("  Run `python -m wikitrace serve` to see the dashboard.")


if __name__ == "__main__":
    main()
