"""Giskard Red-Team Node MCP server -- fleet vulnerability scanning powered by Giskard.

Dual transport: stdio (Claude Desktop) and HTTP (uvicorn when GISKARD_MCP_PORT is set).

MCP tools:
  - run_fleet_scan: Run Giskard adversarial scan against a target MCP server.
  - list_fleet_servers: Discover MCP servers in the fleet port range.
  - get_scan_status: Return current server configuration and scan history.
  - list_reports: List generated HTML vulnerability reports on disk.
  - get_scan: Return one persisted scan record with its issues.
  - get_report_summary: Return the scan record + file meta for a report.
"""

import asyncio
import contextlib
import io
import logging
import os
import sys
from pathlib import Path
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

_SKILLS_DIR = Path(__file__).resolve().parent / "skills"

mcp = FastMCP("Giskard_RedTeam_Node")


@mcp.resource("skill://giskard-redteam/SKILL.md")
async def giskard_redteam_skill() -> str:
    """Red-team operator handbook: tools, profiles, vendors, REST, workflows."""
    return (_SKILLS_DIR / "giskard-redteam" / "SKILL.md").read_text(encoding="utf-8")


@mcp.tool(annotations={"readonly": False}, version="0.2.0")
async def run_fleet_scan(
    mcp_url: Annotated[str, Field(description="MCP server URL to scan, e.g. http://127.0.0.1:10702/mcp")],
    agent_description: Annotated[
        str, Field(description="What the target server does. Used by Giskard to generate targeted attacks.")
    ] = "",
    profiles: Annotated[
        str,
        Field(
            description="Comma-separated scan profiles, e.g. 'prompt_injection,information_disclosure'. Empty = full suite."
        ),
    ] = "",
) -> dict:
    """Run an automated Giskard adversarial scan against a fleet MCP server.

    Connects to the target MCP server via HTTP SSE, discovers its tools,
    wraps the server as a Giskard text_generation model, and runs Giskard's
    adversarial detectors (optionally limited to the given profiles).
    The eval LLM is the saved Settings model (or auto-detected default).

    [RATIONALE]
    One tool wrapping Giskard's entire scanning pipeline for MCP servers.
    Giskard generates the attacks, we route them through MCP tool calls,
    and Giskard evaluates the responses. No custom evaluation logic needed.

    ## Return Format
    {"success": bool, "agent_name": str, "issues_found": bool,
     "issue_count": int, "issues": list, "report_path": str}

    ## Examples
    - run_fleet_scan(mcp_url="http://127.0.0.1:10702/mcp", agent_description="Book search and management API")
    - run_fleet_scan(mcp_url="http://127.0.0.1:10746/mcp", profiles="prompt_injection")
    """
    from .llm_providers import get_key
    from .scanner import (
        detect_llm_details,
        fetch_tools_from_mcp,
        is_cloud_vendor,
        pick_chat_model,
        run_giskard_scan,
    )
    from .store import load_app_settings, upsert_record

    saved = load_app_settings()
    details = await detect_llm_details()
    provider = (saved.get("llm_provider") or details.get("provider") or "local").strip() or "local"
    if provider in ("lm-studio", "ollama"):
        provider = "local"
    if is_cloud_vendor(provider):
        llm_url = saved.get("llm_url", "")
        llm_model = saved.get("llm_model", "")
        llm_key = get_key(provider)
    else:
        llm_url = details.get("url") or saved.get("llm_url", "")
        llm_model = saved.get("llm_model", "") or pick_chat_model(details.get("models") or [])
        llm_key = ""
    if not llm_url or not llm_model:
        return {
            "success": False,
            "error": "No LLM configured. Start LM Studio (:1234)/Ollama (:11434) or set a vendor model + key.",
        }

    tools = await fetch_tools_from_mcp(mcp_url)
    if not tools:
        return {"success": False, "error": f"Could not list tools at {mcp_url}"}

    tool_names = ", ".join(t["name"] for t in tools)
    logger.info("Scanning %s with tools: %s", mcp_url, tool_names)

    agent_name = mcp_url.split("//")[-1].replace("/", "_").replace(":", "_")
    desc = agent_description or f"MCP server at {mcp_url} with tools: {tool_names}"
    profile_list = [p.strip() for p in profiles.split(",") if p.strip()]

    try:
        result = run_giskard_scan(agent_name, desc, mcp_url, tools, profile_list, llm_url, llm_model, provider, llm_key)

        upsert_record(
            SCANS_STORE,
            {
                "agent_name": agent_name,
                "target": mcp_url,
                "issues_found": result["has_issues"],
                "issue_count": result["issue_count"],
                "total_issues": result["issue_count"],
                "tools": tool_names,
                "tools_scanned": len(tools),
                "issues": result.get("issues", []),
                "profiles": result.get("profiles", profile_list),
                "tags": result.get("tags", []),
                "llm_model": llm_model,
                "llm_provider": provider,
                "report_path": result["report_path"],
                "timestamp": __import__("datetime").datetime.now().isoformat(),
            },
        )

        return {
            "success": True,
            "agent_name": agent_name,
            "target": mcp_url,
            "tools_scanned": tool_names,
            "issues_found": result["has_issues"],
            "issue_count": result["issue_count"],
            "issues": result["issues"],
            "profiles": result.get("profiles", profile_list),
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


@mcp.tool(annotations={"readonly": True}, version="0.2.0")
async def get_scan_status() -> dict:
    """Return the current status of the Giskard Red-Team Node.

    ## Return Format
    {"success": bool, "llm_endpoint": str, "total_scans": int}
    """
    from .config import settings
    from .store import load_app_settings

    saved = load_app_settings()
    return {
        "success": True,
        "llm_endpoint": saved.get("llm_url") or settings.llm_api_url,
        "llm_model": saved.get("llm_model", ""),
        "total_scans": len(SCANS_STORE),
        "message": f"Giskard Red-Team Node ready. {len(SCANS_STORE)} scan(s) in history.",
    }


@mcp.tool(annotations={"readonly": True}, version="0.2.0")
async def list_reports(
    limit: Annotated[int, Field(description="Max reports to return.", ge=1)] = 20,
) -> dict:
    """List generated HTML vulnerability reports on disk (newest first).

    ## Return Format
    {"success": bool, "reports": list[{filename, size, modified}], "total": int}

    ## Examples
    - list_reports()
    - list_reports(limit=5)
    """
    import os
    import time

    from .store import reports_dir

    rdir = reports_dir()
    if not rdir.is_dir():
        return {"success": True, "reports": [], "total": 0}
    files = sorted(rdir.glob("*.html"), key=os.path.getmtime, reverse=True)[:limit]
    return {
        "success": True,
        "reports": [
            {"filename": f.name, "size": f.stat().st_size, "modified": time.ctime(f.stat().st_mtime)} for f in files
        ],
        "total": len(list(rdir.glob("*.html"))),
    }


@mcp.tool(annotations={"readonly": True}, version="0.2.0")
async def get_scan(
    agent_name: Annotated[str, Field(description="Scan agent name, e.g. '127.0.0.1_10702_mcp'.")],
) -> dict:
    """Return one persisted scan record with its issues and report path.

    ## Return Format
    {"success": bool, "scan": {agent_name, target, issue_count, issues, ...}}

    ## Examples
    - get_scan(agent_name="127.0.0.1_10702_mcp")
    """
    from .store import normalize_scan

    matches = [s for s in SCANS_STORE if s.get("agent_name") == agent_name]
    if not matches:
        return {"success": False, "error": f"No scan for '{agent_name}'"}
    return {"success": True, "scan": normalize_scan(matches[-1])}


@mcp.tool(annotations={"readonly": True}, version="0.2.0")
async def get_report_summary(
    filename: Annotated[
        str, Field(description="Report filename, e.g. '127.0.0.1_10702_mcp_vulnerability_report.html'.")
    ],
) -> dict:
    """Return the scan record plus file metadata for one HTML report.

    ## Return Format
    {"success": bool, "scan": dict|None, "file": {filename, size, modified}}

    ## Examples
    - get_report_summary(filename="127.0.0.1_10702_mcp_vulnerability_report.html")
    """
    import time
    from pathlib import Path

    from .store import normalize_scan, reports_dir

    safe = Path(filename).name
    target = reports_dir() / safe
    if not target.is_file() or target.suffix != ".html":
        return {"success": False, "error": "Report not found"}
    scan = next((normalize_scan(s) for s in reversed(SCANS_STORE) if safe in s.get("report_path", "")), None)
    return {
        "success": True,
        "scan": scan,
        "file": {"filename": safe, "size": target.stat().st_size, "modified": time.ctime(target.stat().st_mtime)},
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
