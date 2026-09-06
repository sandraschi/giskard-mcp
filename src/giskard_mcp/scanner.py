"""Fleet MCP vulnerability scanner powered by Giskard.

Discovers MCP servers on the local network, wraps them as Giskard models,
and runs automated adversarial red-teaming scans using Giskard's LLM detectors.
LM Studio is auto-detected for Giskard's internal LLM calls.
"""

import asyncio
import logging
import os
from pathlib import Path

import httpx
import pandas as pd

from .config import settings

logger = logging.getLogger("giskardmcp.scanner")

FLEET_PORTS = list(range(settings.fleet_port_start, settings.fleet_port_end + 1))


async def detect_llm() -> str | None:
    """Auto-detect LM Studio (preferred) or Ollama. Sets env vars for Giskard."""
    for url, label, env_url in [
        ("http://127.0.0.1:1234/v1", "LM Studio", "http://127.0.0.1:1234/v1"),
        ("http://localhost:1234/v1", "LM Studio", "http://localhost:1234/v1"),
    ]:
        try:
            async with httpx.AsyncClient(timeout=3) as client:
                r = await client.get(f"{url}/models")
                if r.status_code == 200:
                    os.environ["GISKARD_LLM_API_URL"] = env_url
                    logger.info("Detected %s at %s", label, url)
                    return url
        except Exception:
            continue
    for url in ["http://127.0.0.1:11434", "http://localhost:11434"]:
        try:
            async with httpx.AsyncClient(timeout=3) as client:
                r = await client.get(f"{url}/api/tags")
                if r.status_code == 200:
                    os.environ["GISKARD_LLM_API_URL"] = f"{url}/v1"
                    logger.info("Detected Ollama at %s", url)
                    return f"{url}/v1"
        except Exception:
            continue
    logger.warning("No local LLM detected (LM Studio :1234, Ollama :11434)")
    return None


async def discover_servers() -> list[dict]:
    """Scan fleet port range for MCP HTTP endpoints."""
    discovered = []
    async with httpx.AsyncClient(timeout=3) as client:
        for port in FLEET_PORTS:
            try:
                r = await client.get(f"http://127.0.0.1:{port}/health")
                if r.status_code == 200:
                    data = r.json() if "json" in r.headers.get("content-type", "") else {}
                    discovered.append(
                        {
                            "port": port,
                            "url": f"http://127.0.0.1:{port}",
                            "service": data.get("service") or data.get("name") or f"port-{port}",
                        }
                    )
            except Exception:
                continue
    return discovered


async def fetch_tools_from_mcp(mcp_url: str) -> list[dict]:
    """Connect to an MCP server and list its tools."""
    from mcp import ClientSession
    from mcp.client.sse import sse_client

    async with sse_client(mcp_url) as (read, write), ClientSession(read, write) as session:
        result = await session.list_tools()
        tools = getattr(result, "tools", result)
        return [
            {
                "name": getattr(t, "name", str(t)),
                "description": getattr(t, "description", ""),
                "schema": str(getattr(t, "inputSchema", {})),
            }
            for t in tools
        ]


async def call_mcp_tool(mcp_url: str, tool_name: str, prompt: str) -> str:
    """Call an MCP tool with an adversarial prompt."""
    from mcp import ClientSession
    from mcp.client.sse import sse_client

    async with sse_client(mcp_url) as (read, write), ClientSession(read, write) as session:
        try:
            result = await session.call_tool(tool_name, arguments={"prompt": prompt})
            if hasattr(result, "content") and result.content:
                parts = []
                for item in result.content:
                    if hasattr(item, "text") and item.text:
                        parts.append(item.text)
                    elif hasattr(item, "data") and item.data:
                        parts.append(f"[binary: {len(item.data)} bytes]")
                return "\n".join(parts) if parts else str(result)
            return str(result)
        except Exception as e:
            return f"CALL_ERROR: {e}"


def run_giskard_scan(agent_name: str, agent_description: str, mcp_url: str, tools: list[dict]) -> dict:
    """Wrap the MCP server as a Giskard model and run a scan.

    Giskard generates adversarial prompts, we route them through MCP tool calls,
    and Giskard evaluates the responses for vulnerabilities.
    """
    import giskard

    def predict(df: pd.DataFrame) -> list[str]:
        """Giskard-compatible prediction: routes prompts through the MCP server."""
        tool_names = [t["name"] for t in tools]
        primary_tool = tool_names[0] if tool_names else "unknown"
        results = []
        for question in df["question"]:
            try:
                result = asyncio.run(call_mcp_tool(mcp_url, primary_tool, question))
                results.append(result)
            except Exception as e:
                results.append(f"EXEC_ERROR: {e}")
        return results

    giskard_model = giskard.Model(
        model=predict,
        model_type="text_generation",
        name=agent_name,
        description=agent_description,
        feature_names=["question"],
    )

    scan_results = giskard.scan(giskard_model)

    report_path = str(Path(settings.local_reports_dir) / f"{agent_name}_vulnerability_report.html")
    scan_results.to_html(report_path)

    issues = []
    if scan_results.has_issues():
        for issue in scan_results.issues:
            issues.append(
                {
                    "group": getattr(issue, "group", "unknown"),
                    "description": getattr(issue, "description", ""),
                    "severity": getattr(issue, "level", "unknown"),
                }
            )

    return {
        "success": True,
        "agent_name": agent_name,
        "has_issues": scan_results.has_issues(),
        "issue_count": len(issues),
        "issues": issues,
        "report_path": report_path,
    }
