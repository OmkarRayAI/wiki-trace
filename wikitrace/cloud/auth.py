"""API key generation, hashing, and resolution.

Format: ``wt_live_<32 hex>``. Plaintext is shown to the operator
exactly once at creation time. Only the SHA-256 hash is stored.

Compare keys via ``compare_digest`` to avoid timing-side-channel
attacks on key prefixes.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from dataclasses import dataclass
from typing import Optional


KEY_PREFIX = "wt_live_"


@dataclass
class KeyInfo:
    """Returned by :func:`generate_key` so the caller can hand the
    plaintext to the user, store the hash, and remember the id."""
    key_id: str          # short opaque id used in admin URLs
    plaintext: str       # full key — show once, never store
    key_hash: str        # sha256 hex; store this


def generate_key() -> KeyInfo:
    """Generate a new API key. The plaintext is returned once;
    persist only the hash."""
    body = secrets.token_hex(16)            # 32 hex chars = 128 bits
    plaintext = f"{KEY_PREFIX}{body}"
    return KeyInfo(
        key_id=secrets.token_hex(8),
        plaintext=plaintext,
        key_hash=hash_key(plaintext),
    )


def hash_key(plaintext: str) -> str:
    """SHA-256 of the plaintext key. Constant work — no salt — because
    keys are themselves random; offline-attack risk against a single
    hashed key is negligible vs the ergonomics cost of per-key salts.
    """
    return hashlib.sha256(plaintext.encode("utf-8")).hexdigest()


def looks_like_key(plaintext: str) -> bool:
    """Cheap shape check. Reject obviously-malformed keys before
    hitting the DB."""
    if not isinstance(plaintext, str):
        return False
    return plaintext.startswith(KEY_PREFIX) and len(plaintext) == len(KEY_PREFIX) + 32


def secure_equal(a: str, b: str) -> bool:
    return hmac.compare_digest(a, b)
