"""wiki-trace ↔ Anthropic SDK auto-patching."""
from .patch import patch, unpatch

__all__ = ["patch", "unpatch"]
