# Examples

Each script is self-contained and runnable in under 30 seconds.

| Script | What it shows |
|---|---|
| [`openai_quickstart.py`](openai_quickstart.py) | One-line OpenAI / OpenRouter auto-patching with cost + token streaming |
| [`anthropic_quickstart.py`](anthropic_quickstart.py) | One-line Anthropic auto-patching |
| [`decorators_quickstart.py`](decorators_quickstart.py) | `@trace` and `@tool` for RAG and agent steps in Python (sync + async) |
| [`eval_quickstart.py`](eval_quickstart.py) | Dataset, judges, `run_eval`, `compare_runs` — no LLM required |
| [`budget_quickstart.py`](budget_quickstart.py) | Cost budgeting with `wikitrace.budget(usd=...)` |
| [`langchain_rag.py`](langchain_rag.py) | LangChain `WikitraceCallbackHandler` end-to-end |
| [`byo_rag.py`](byo_rag.py) | Bring-your-own RAG — manual `wikitrace.span()` calls |

## Free verification path

Most examples need an LLM key. **OpenRouter offers free-tier models**
that work with the OpenAI-compatible patch:

```bash
# Sign up at openrouter.ai, no card needed
export OPENROUTER_API_KEY=sk-or-...
python examples/openai_quickstart.py
```

The script auto-detects `OPENROUTER_API_KEY` and uses
`liquid/lfm-2.5-1.2b-instruct:free` — verified working in CI.
