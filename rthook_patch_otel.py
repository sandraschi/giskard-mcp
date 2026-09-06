"""PyInstaller runtime hook: fix opentelemetry entry_points in frozen builds."""
import functools
import os
os.environ["OTEL_PYTHON_CONTEXT"] = "contextvars_context"

import opentelemetry.util._importlib_metadata as _im
from importlib.metadata import EntryPoint

_FIXED_ENTRY_POINTS = {
    ("opentelemetry_context", "contextvars_context"):
        "opentelemetry.context.contextvars_context:ContextVarsRuntimeContext",
    ("opentelemetry_propagator", "baggage"):
        "opentelemetry.baggage.propagation:W3CBaggagePropagator",
    ("opentelemetry_propagator", "tracecontext"):
        "opentelemetry.trace.propagation.tracecontext:TraceContextTextMapPropagator",
    ("opentelemetry_tracer_provider", "default_tracer_provider"):
        "opentelemetry.trace:NoOpTracerProvider",
    ("opentelemetry_meter_provider", "default_meter_provider"):
        "opentelemetry.metrics:NoOpMeterProvider",
    ("opentelemetry_environment_variables", "api"):
        "opentelemetry.environment_variables",
}

_orig = _im.entry_points

@functools.cache
def _patched_ep(*, group=None, name=None, **kw):
    key = (group, name)
    if key in _FIXED_ENTRY_POINTS:
        value = _FIXED_ENTRY_POINTS[key]
        return _im.EntryPoints([EntryPoint(name=name, value=value, group=group)])
    return _orig(group=group, name=name, **kw)

_im.entry_points = _patched_ep
