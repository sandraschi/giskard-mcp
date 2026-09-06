"""Giskard Red-Team Node MCP server -- fleet vulnerability scanning powered by Giskard.

Dual transport: stdio (Claude Desktop) and HTTP (uvicorn when GISKARD_MCP_PORT is set).

MCP tools:
  - run_fleet_scan: Run Giskard adversarial scan against a target MCP server.
  - list_fleet_servers: Discover MCP servers in the fleet port range.
  - get_scan_status: Return current server configuration and scan history.
"""

import asyncio
import contextlib
import io
import logging
import os
import sys
from typing import Annotated

from fastmcp import FastMCP
from pydantic import Field

if sys.platform == "win32":
    import msvcrt

    for _stream in (sys.stdin, sys.stdout):
        _fileno = getattr(_stream, "fileno", None)
        if _fileno:
            with contextlib.suppress(OSError, io.UnsupportedOperation):
                msvcrt.setmode(_fileno(), os.O_BINARY)

logger = logging.getLogger("giskardmcp.server")

SCANS_STORE: list[dict] = []

mcp = FastMCP("Giskard_RedTeam_Node")


@mcp.tool(annotations={"readonly": False}, version="0.1.0")
async def run_fleet_scan(
    mcp_url: Annotated[str, Field(description="MCP server URL to scan, e.g. http://127.0.0.1:10702/mcp")],
    agent_description: Annotated[
        str, Field(description="What the target server does. Used by Giskard to generate targeted attacks.")
    ] = "",
) -> dict:
    """Run an automated Giskard adversarial scan against a fleet MCP server.

    Connects to the target MCP server via HTTP SSE, discovers its tools,
    wraps the server as a Giskard text_generation model, and runs Giskard's
    full adversarial scan suite (prompt injection, harmful content, data leakage, etc.).

    [RATIONALE]
    One tool wrapping Giskard's entire scanning pipeline for MCP servers.
    Giskard generates the attacks, we route them through MCP tool calls,
    and Giskard evaluates the responses. No custom evaluation logic needed.

    ## Return Format
    {"success": bool, "agent_name": str, "issues_found": bool,
     "issue_count": int, "issues": list, "report_path": str}

    ## Examples
    - run_fleet_scan(mcp_url="http://127.0.0.1:10702/mcp", agent_description="Book search and management API")
    - run_fleet_scan(mcp_url="http://127.0.0.1:10746/mcp")
    """
    from .scanner import detect_llm, fetch_tools_from_mcp, run_giskard_scan

    llm_url = await detect_llm()
    if not llm_url:
        return {"success": False, "error": "No local LLM detected. Start LM Studio (:1234) or Ollama (:11434)."}

    tools = await fetch_tools_from_mcp(mcp_url)
    if not tools:
        return {"success": False, "error": f"Could not list tools at {mcp_url}"}

    tool_names = ", ".join(t["name"] for t in tools)
    logger.info("Scanning %s with tools: %s", mcp_url, tool_names)

    agent_name = mcp_url.split("//")[-1].replace("/", "_").replace(":", "_")
    desc = agent_description or f"MCP server at {mcp_url} with tools: {tool_names}"

    try:
        result = run_giskard_scan(agent_name, desc, mcp_url, tools)

        SCANS_STORE.append(
            {
                "agent_name": agent_name,
                "target": mcp_url,
                "issues_found": result["has_issues"],
                "issue_count": result["issue_count"],
                "tools": tool_names,
                "report_path": result["report_path"],
                "timestamp": __import__("datetime").datetime.now().isoformat(),
            }
        )

        return {
            "success": True,
            "agent_name": agent_name,
            "target": mcp_url,
            "tools_scanned": tool_names,
            "issues_found": result["has_issues"],
            "issue_count": result["issue_count"],
            "issues": result["issues"],
            "report_path": result["report_path"],
            "message": f"Giskard scan of '{mcp_url}' complete. {result['issue_count']} issue(s) found."
            if result["has_issues"]
            else f"Giskard scan of '{mcp_url}' complete. Clean.",
        }
    except Exception as e:
        logger.exception("Giskard scan failed for %s", mcp_url)
        return {"success": False, "target": mcp_url, "error": str(e)}


@mcp.tool(annotations={"readonly": True}, version="0.1.0")
async def list_fleet_servers(
    limit: Annotated[int, Field(description="Max servers to return.", ge=1)] = 50,
) -> dict:
    """Discover running MCP servers in the fleet port range (10700-11500).

    Probes each port for health endpoints and returns a list of
    active servers with their URLs and service names.

    ## Return Format
    {"success": bool, "servers": list[dict], "total": int}

    ## Examples
    - list_fleet_servers()
    """
    from .scanner import discover_servers

    servers = await discover_servers()
    return {"success": True, "servers": servers[:limit], "total": len(servers)}


@mcp.tool(annotations={"readonly": True}, version="0.1.0")
async def get_scan_status() -> dict:
    """Return the current status of the Giskard Red-Team Node.

    ## Return Format
    {"success": bool, "llm_endpoint": str, "total_scans": int}
    """
    from .config import settings

    return {
        "success": True,
        "llm_endpoint": settings.llm_api_url,
        "total_scans": len(SCANS_STORE),
        "message": f"Giskard Red-Team Node ready. {len(SCANS_STORE)} scan(s) in history.",
    }


def main() -> int:
    transport = os.getenv("MCP_TRANSPORT", "stdio")
    if transport == "http":
        import uvicorn

        from giskard_mcp.app import app
        from giskard_mcp.config import settings

        logger.info("Starting HTTP server on %s:%s", settings.host, settings.port)
        uvicorn.run(app, host=settings.host, port=settings.port, log_level="info")
        return 0
    logger.info("Starting stdio server")
    asyncio.run(mcp.run_stdio_async())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
