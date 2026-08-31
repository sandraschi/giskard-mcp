"""Entry point for uv run giskard-mcp and python -m giskard_mcp.

CLI flags:
    --stdio    Force stdio mode (default)
    --serve    Force HTTP server mode with uvicorn
"""

import os
import sys


def main() -> int:
    if "--serve" in sys.argv or "--http" in sys.argv:
        os.environ["MCP_TRANSPORT"] = "http"
    elif "--stdio" in sys.argv:
        os.environ["MCP_TRANSPORT"] = "stdio"

    from giskard_mcp.server import main as server_main

    return server_main()


if __name__ == "__main__":
    raise SystemExit(main())
