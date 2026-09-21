# Configuration

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `GISKARD_MCP_HOST` | `127.0.0.1` | HTTP bind host |
| `GISKARD_MCP_PORT` | `11056` | Backend port (frontend is +1) |
| `GISKARD_MCP_HTTP_PATH` | `/mcp` | Mount path of this server's own MCP endpoint |
| `MCP_TRANSPORT` | `stdio` | `stdio` (Claude Desktop) or `http` (webapp backend) |
| `GISKARD_LLM_API_URL` | `http://127.0.0.1:1234/v1` | Default local LLM endpoint |
| `GISKARD_LLM_API_KEY` | `not-needed` | Default key (local endpoints ignore it) |
| `GISKARD_LLM_MODEL` | `` | Default judge/chat model |
| `GISKARD_TARGET_MCP_URL` | `` | Pre-filled scan target |
| `GISKARD_REPORTS_DIR` | `/app/reports` | Report dir (falls back to `./reports`) |
| `GISKARD_FLEET_PORT_START` | `10700` | Discover range start |
| `GISKARD_FLEET_PORT_END` | `11500` | Discover range end |
| `OPENAI_API_KEY` | `` | Cloud fallback: OpenAI |
| `ANTHROPIC_API_KEY` | `` | Cloud fallback: Anthropic |
| `AZURE_API_KEY` | `` | Cloud fallback: Azure OpenAI |
| `AZURE_API_VERSION` | `2024-02-01` | Azure API version |
| `GISKARD_TAURI` | `` | `1` to allow `tauri.localhost` CORS origins |

## Setting Variables

Most LLM settings live in the webapp (Settings page → `app_settings.json`,
API key stored server-side only). Env vars are defaults underneath.

In `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "giskard": {
      "command": "uv",
      "args": ["run", "--directory", "C:\\path\\to\\giskard-mcp", "python", "-m", "giskard_mcp.server"],
      "env": {
        "PYTHONUNBUFFERED": "1",
        "GISKARD_LLM_MODEL": "llama3.2"
      }
    }
  }
}
```

## Data files (all under `reports/` unless `GISKARD_REPORTS_DIR` exists)

| File | Contents |
|------|----------|
| `*_vulnerability_report.html` | Giskard HTML reports |
| `scans_index.json` | Scan history (survives restarts) |
| `targets.json` | Saved scan targets |

`src/giskard_mcp/app_settings.json` holds Settings (LLM url/model/provider,
stored key, default target). All JSON writes are atomic (tmp + replace).
