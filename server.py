"""Dev entry point for ``uv run python server.py`` (stdio MCP server).

For Docker, the entry point is ``python -m giskard_mcp --stdio``.
For local HTTP mode, use ``uv run giskard-mcp --serve``.
"""
from giskard_mcp.server import mcp
import asyncio

if __name__ == "__main__":
    asyncio.run(mcp.run_stdio_async())
