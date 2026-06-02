"""Short alias: ``import wikitrace.anthropic; wikitrace.anthropic.patch()``."""
from ..integrations.anthropic import patch, unpatch

__all__ = ["patch", "unpatch"]
