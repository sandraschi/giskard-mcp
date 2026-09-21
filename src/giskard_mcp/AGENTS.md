# src/giskard_mcp — package layer

## Key Files

| File | Purpose |
|------|---------|
| `server.py` | FastMCP instance, 6 tools, skill resource. Entry: `main()`, `mcp` |
| `app.py` | Starlette REST (`/api/v1/...`), background jobs, depot CRUD. Entry: `app` |
| `scanner.py` | Transports, Giskard wrap, profiles→tags, vendor LLM config. Entry: `run_giskard_scan`, `fetch_tools_from_mcp`, `configure_giskard_llm` |
| `store.py` | Disk depot: scan index, targets, settings helpers. Entry: `upsert_record`, `delete_scan`, `add_target` |
| `config.py` | Env-driven `Settings`. Entry: `settings` |
| `skills/giskard-redteam/SKILL.md` | Operator handbook served as `skill://` resource |
| `__main__.py` | `python -m` entry |

## Entry Points

- `server.run_fleet_scan` — sync scan pipeline (agent waits); `app.trigger_scan` — 202 + job id (webapp polls)
- `scanner._resolve` chain: `_open_mcp_session` (streamable→SSE) → `_prompt_param` (schema-mapped attack field)

## Next (reading order)

1. `server.py` — tool contracts first
2. `scanner.py` — how scans actually run
3. `app.py` — jobs + REST around the same core
4. `store.py` — persistence behind both lanes
