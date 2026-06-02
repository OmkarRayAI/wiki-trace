"""wiki-trace ↔ OpenTelemetry export.

Subscribes to wikitrace span lifecycle hooks and emits OpenTelemetry
spans in parallel — same trace, two destinations.

    import wikitrace
    from wikitrace.otel import install

    # Configure OTel however you normally would (env vars, OTLP endpoint,
    # whatever exporter your platform of choice uses):
    #     OTEL_EXPORTER_OTLP_ENDPOINT=https://your-collector
    #     OTEL_SERVICE_NAME=my-app

    install()              # one line; emits OTel spans alongside JSONL
    wikitrace.init(pipeline="my-app")
    # ... your code ...

Once installed, every wikitrace span produces a real OTel span with
matching trace_id, parent_span_id, attributes, status, events, and
duration. Pipe into Phoenix, Datadog, Honeycomb, Grafana, or any OTel
collector — they will see wiki-trace runs in their normal UI.
"""

from .exporter import install, uninstall

__all__ = ["install", "uninstall"]
