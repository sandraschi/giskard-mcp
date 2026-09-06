"""PyInstaller entry point - dual transport (stdio + HTTP).

Detects GISKARD_MCP_PORT env var from Tauri spawn and starts uvicorn.
Otherwise runs stdio MCP for Claude Desktop.
"""
import os
import sys

# Fix opentelemetry context loading in frozen builds (entry points don't work)
os.environ.setdefault("OTEL_PYTHON_CONTEXT", "contextvars_context")

# Eager-import stdlib C extensions that PyInstaller misses
import _datetime  # noqa: F401
import _strptime  # noqa: F401
# Eager-import mcp.types to bootstrap mcp before fastmcp touches it
import mcp.types  # noqa: F401
sys.path.insert(0, "src")

port = os.environ.get("GISKARD_MCP_PORT") or os.environ.get("MCP_PORT") or os.environ.get("PORT")

if port:
    host = os.environ.get("MCP_HOST", "127.0.0.1")
    # Overwrite sys.argv before argparse-based main() sees frozen PyInstaller args
    sys.argv = ["run_server.py", "--serve", "--host", host, "--port", str(port)]

    import uvicorn
    from giskard_mcp.app import app

    uvicorn.run(app, host=host, port=int(port), log_level="info")
else:
    from giskard_mcp.server import mcp
    import asyncio
    asyncio.run(mcp.run_stdio_async())
