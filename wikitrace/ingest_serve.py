"""``python -m wikitrace.ingest_serve`` — wraps :func:`ingest_server.main`."""
from .ingest_server import main

if __name__ == "__main__":
    import sys
    sys.exit(main())
