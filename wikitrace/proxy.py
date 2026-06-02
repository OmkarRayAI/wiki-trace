"""One-line proxy helpers for OpenAI / Anthropic clients.

For users who'd rather change a base URL than monkey-patch a module,
this hands back a pre-configured SDK client that routes through a
running wiki-trace ingest server. Every request is logged as an
``llm_call`` span on the way through; the response is returned to
your code unchanged.

    import wikitrace.proxy

    client = wikitrace.proxy.openai(base_url="http://localhost:8765")
    resp = client.chat.completions.create(model="gpt-4o", messages=[...])

    anth = wikitrace.proxy.anthropic(base_url="http://localhost:8765")
    msg = anth.messages.create(model="claude-sonnet-4-6", messages=[...])

The proxy server must be running:

    python -m wikitrace.ingest_serve --port 8765

Use the ``properties`` / ``user_id`` / ``session_id`` kwargs to attach
metadata that surfaces as Helicone-* headers on every call this client
makes. Same shape Helicone users already know.
"""

from __future__ import annotations

from typing import Any


def _build_default_headers(
    api_key: str | None,
    user_id: str | None,
    session_id: str | None,
    session_name: str | None,
    session_path: str | None,
    cache_enabled: bool | None,
    properties: dict | None,
) -> dict:
    h: dict = {}
    if api_key:
        h["Helicone-Auth"] = f"Bearer {api_key}"
    if user_id:
        h["Helicone-User-Id"] = user_id
    if session_id:
        h["Helicone-Session-Id"] = session_id
    if session_name:
        h["Helicone-Session-Name"] = session_name
    if session_path:
        h["Helicone-Session-Path"] = session_path
    if cache_enabled is not None:
        h["Helicone-Cache-Enabled"] = "true" if cache_enabled else "false"
    for k, v in (properties or {}).items():
        h[f"Helicone-Property-{k}"] = str(v)
    return h


def openai(
    base_url: str = "http://localhost:8765",
    api_key: str | None = None,
    user_id: str | None = None,
    session_id: str | None = None,
    session_name: str | None = None,
    session_path: str | None = None,
    cache_enabled: bool | None = None,
    properties: dict | None = None,
    **client_kwargs: Any,
):
    """Return an ``openai.OpenAI`` client routed through the wiki-trace
    proxy. Pass the same ``api_key`` / model / streaming kwargs you
    normally would; this just rewrites the base URL and stamps
    Helicone-* headers on every request.

    The ``api_key`` arg here is the wiki-trace ingest API key (sent as
    ``Helicone-Auth: Bearer …``). Your OpenAI key still needs to come
    from the environment (``OPENAI_API_KEY``) or the ``client_kwargs``
    — it's forwarded through to api.openai.com as the upstream auth.
    """
    try:
        import openai as _openai
    except ImportError as e:
        raise ImportError(
            "wikitrace.proxy.openai() requires the openai package. "
            "Install with: pip install openai"
        ) from e

    headers = _build_default_headers(
        api_key, user_id, session_id, session_name,
        session_path, cache_enabled, properties,
    )
    return _openai.OpenAI(
        base_url=base_url.rstrip("/") + "/oai/v1",
        default_headers=headers,
        **client_kwargs,
    )


def anthropic(
    base_url: str = "http://localhost:8765",
    api_key: str | None = None,
    user_id: str | None = None,
    session_id: str | None = None,
    session_name: str | None = None,
    session_path: str | None = None,
    cache_enabled: bool | None = None,
    properties: dict | None = None,
    **client_kwargs: Any,
):
    """Return an ``anthropic.Anthropic`` client routed through the
    wiki-trace proxy. Same shape as :func:`openai`."""
    try:
        import anthropic as _anthropic
    except ImportError as e:
        raise ImportError(
            "wikitrace.proxy.anthropic() requires the anthropic package. "
            "Install with: pip install anthropic"
        ) from e

    headers = _build_default_headers(
        api_key, user_id, session_id, session_name,
        session_path, cache_enabled, properties,
    )
    return _anthropic.Anthropic(
        base_url=base_url.rstrip("/") + "/anthropic",
        default_headers=headers,
        **client_kwargs,
    )
