"""Short alias: ``import wikitrace.openai; wikitrace.openai.patch()``."""
from ..integrations.openai import patch, unpatch

__all__ = ["patch", "unpatch"]
