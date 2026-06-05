"""60-second quickstart: Anthropic + wiki-trace.

    pip install 'wikitrace' anthropic
    ANTHROPIC_API_KEY=sk-ant-... python examples/anthropic_quickstart.py
"""

import anthropic
import wikitrace
import wikitrace.anthropic


def main():
    wikitrace.anthropic.patch()

    client = anthropic.Anthropic()
    wikitrace.init(pipeline="quickstart-anthropic")
    with wikitrace.session(id="demo-anthropic", user="alice"):
        msg = client.messages.create(
            model="claude-haiku-4-5",
            max_tokens=20,
            messages=[{"role": "user", "content": "what color is the sky?"}],
        )
        print("Answer:", msg.content[0].text)
    wikitrace.end()

    print("\n✓ Spans written to .wikitrace/spans.jsonl")


if __name__ == "__main__":
    main()
