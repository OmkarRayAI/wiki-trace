"""Built-in judges: deterministic and LLM-as-judge fallbacks."""

from __future__ import annotations

from wikitrace import judges


# ─── Deterministic judges ──────────────────────────────────────────────


def test_exact_match():
    assert judges.exact_match("blue", {"expected": "blue"}).correct == 1
    assert judges.exact_match("BLUE", {"expected": "blue"}).correct == 1
    assert judges.exact_match("red", {"expected": "blue"}).correct == 0


def test_contains_all_string_expected():
    r = judges.contains_all("the sky is blue", {"expected": "blue"})
    assert r.correct == 1 and r.total == 1


def test_contains_all_list_expected():
    r = judges.contains_all("emperor and king penguins",
                            {"expected": ["emperor", "king"]})
    assert r.correct == 2 and r.total == 2

    r2 = judges.contains_all("emperor only",
                             {"expected": ["emperor", "king"]})
    assert r2.correct == 1 and r2.total == 2


def test_contains_none_safety_list():
    ctx = {"expected": ["secret", "password"]}
    assert judges.contains_none("everything fine", ctx).correct == 1
    assert judges.contains_none("the password is hunter2", ctx).correct == 0


def test_regex_match():
    r = judges.regex_match("answer is 42", {"expected": r"\b\d+\b"})
    assert r.correct == 1
    r2 = judges.regex_match("no digits here", {"expected": r"\b\d+\b"})
    assert r2.correct == 0


def test_length_within():
    j = judges.length_within(min=3, max=10)
    assert j("hi", {}).correct == 0
    assert j("hello", {}).correct == 1
    assert j("this is too long", {}).correct == 0


def test_json_valid_plain():
    assert judges.json_valid('{"a": 1}', {}).correct == 1
    assert judges.json_valid("not json", {}).correct == 0


def test_json_valid_strips_fences():
    assert judges.json_valid('```json\n{"a": 1}\n```', {}).correct == 1


def test_schema_match_object():
    s = judges.schema_match({
        "type": "object",
        "required": ["a", "b"],
        "properties": {"a": {"type": "string"}, "b": {"type": "number"}},
    })
    assert s('{"a": "x", "b": 1}', {}).correct == 1
    assert s('{"a": "x"}', {}).correct == 0           # missing b
    assert s('{"a": 1, "b": 1}', {}).correct == 0     # wrong type


def test_sql_valid_basic():
    assert judges.sql_valid("SELECT 1", {}).correct == 1
    assert judges.sql_valid("SELEKT * FRM nope", {}).correct == 0


def test_sql_valid_missing_table_is_acceptable():
    """SELECT against a table we haven't created should pass syntax
    check — the caller is testing query generation, not schema fit."""
    assert judges.sql_valid("SELECT * FROM users", {}).correct == 1


def test_no_pii_clean_text():
    assert judges.no_pii("the answer is blue", {}).correct == 1


def test_no_pii_email_caught():
    r = judges.no_pii("contact alice@example.com", {})
    assert r.correct == 0
    assert "email" in r.detail["hits"]


def test_no_pii_ssn_caught():
    r = judges.no_pii("ssn 123-45-6789", {})
    assert r.correct == 0
    assert "ssn" in r.detail["hits"]


def test_levenshtein_threshold():
    j = judges.levenshtein_threshold(threshold=0.7)
    assert j("the sky is blue", {"expected": "the sky is blue"}).correct == 1
    assert j("the sky is bleu", {"expected": "the sky is blue"}).correct == 1
    assert j("penguins fly", {"expected": "the sky is blue"}).correct == 0


# ─── LLM-as-judge graceful fallbacks ───────────────────────────────────


def test_llm_judge_no_openai_returns_error_in_detail():
    """Without an openai client wired up, llm_judge must return
    score 0 with `error` in detail rather than crashing."""
    j = judges.llm_judge("Is the answer correct?")
    # Force the lazy-import path to fail by passing a fake client that
    # raises on use. The judge should catch and return 0/1 with error.
    class BoomClient:
        class chat:
            class completions:
                @staticmethod
                def create(**_):
                    raise RuntimeError("simulated upstream failure")
    j2 = judges.llm_judge("rubric", client=BoomClient())
    r = j2("answer", {"input": "q", "expected": "y"})
    assert r.correct == 0
    assert "error" in r.detail


def test_llm_classify_no_openai():
    class BoomClient:
        class chat:
            class completions:
                @staticmethod
                def create(**_):
                    raise RuntimeError("nope")
    j = judges.llm_classify("rubric", ["a", "b"], client=BoomClient())
    r = j("answer", {"input": "q", "expected": "a"})
    assert r.correct == 0
    assert "error" in r.detail


def test_rag_faithfulness_requires_context():
    """When metadata.context is missing, must return 0/1 with a clear
    error rather than crashing."""
    j = judges.rag_faithfulness()
    r = j("answer", {"input": "q", "expected": "x", "metadata": {}})
    assert r.correct == 0
    assert "error" in r.detail
