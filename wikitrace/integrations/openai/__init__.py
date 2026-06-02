"""wiki-trace ↔ OpenAI SDK auto-patching."""
from .patch import patch, unpatch

__all__ = ["patch", "unpatch"]
