# giskard-mcp — Claude Code Guide

## Overview
Giskard Red-Team Node: scan live MCP servers for prompt-injection, jailbreak,
data-leakage and harmful-content vulnerabilities. Jobs run in the background;
evidence persists in `reports/`. Backend :11056, frontend :11057.

## Entry Points
- `uv run python -m giskard_mcp.server` (stdio) · `MCP_TRANSPORT=http` (backend)
- `.\start.ps1` for the full stack

## Session Context
You have 6 tools: `run_fleet_scan` (pipeline), `list_fleet_servers`
(discover before guessing URLs), `get_scan_status`, `list_reports`,
`get_scan`, `get_report_summary`. Skill: `skill://giskard-redteam/SKILL.md`
— read it for profiles, vendors, and workflows.
- Scan something: `run_fleet_scan(mcp_url="http://127.0.0.1:10702/mcp", profiles="prompt_injection")`
- Targets must be LIVE servers (`.../mcp`), never source code or webapp ports.

## Standards
- Responses are `{success, ...}` dicts; errors carry `error` + recovery hints
- See `AGENTS.md` for repo map, `docs/` for user reference
