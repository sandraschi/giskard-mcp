# giskard-mcp — Agent Guide

## Overview
Giskard Red-Team Node: adversarial vulnerability scans against live MCP
servers (Giskard detectors + local/cloud LLM judges), background jobs,
persisted report depot, React webapp. Backend :11056, frontend :11057.

## Entry Points
- `uv run python -m giskard_mcp.server` → stdio, or `MCP_TRANSPORT=http` → uvicorn (`giskard_mcp.app:app`)
- `.\start.ps1` → backend + frontend via `fleet-start.config.ps1` (do not edit start logic)
- REST: `/api/v1/...` (scans, jobs, reports, targets, chat, settings)

## Key Files
- `src/giskard_mcp/AGENTS.md` — package layer map (read next)
- `README.md` + `docs/` — user docs (ONBOARDING/CONFIG/TOOLS/TROUBLESHOOT/DEV/ARCH)
- `pyproject.toml` — deps, ruff config; `fleet-start.config.ps1` — ports

## Standards
- FastMCP 3.4 (`>=3.4.4,<4`); 6 tools return `{success, ...}`; 1 skill resource
- Starlette (no Pydantic); ruff check + format clean; `tsc --noEmit` + build clean
- Batch edits of 3+ files need timestamped `.bak` copies first; max 5 files per commit
- Prove changes by running them (endpoint smoke test, not just lint)

## Directory Map
1. `src/giskard_mcp/AGENTS.md` — server/app/scanner/store, entry points
2. `webapp/frontend/src/` — pages, api client, stores (no per-dir map; small)
3. `docs/` — user-facing reference
