# Tool Reference

6 MCP tools + 1 skill resource. All tools return `{success, ...}`; errors
return `{success: false, error}` with a human-readable message.

## `run_fleet_scan`

Run the full pipeline against a live MCP server: detect LLM → list target
tools → run Giskard → persist record + HTML report.

```python
run_fleet_scan(
    mcp_url="http://127.0.0.1:10702/mcp",
    agent_description="Book search and management API",
    profiles="",   # comma-separated subset, "" = full suite
)
# -> {success, agent_name, target, tools_scanned, issues_found,
#     issue_count, issues[{group, description, severity}], profiles, report_path}
```

`profiles` picks detector families: `prompt_injection`,
`information_disclosure`, `harmful_content`, `hallucination`, `bias`,
`boundary_testing`, `role_play`. The judge is the saved Settings model (or
auto-detected default).

## `list_fleet_servers`

Probe ports 10700–11500 for `/health`. Returns `{servers[{port, url,
service, ok, mcp_available}], total}`. Use this before guessing URLs.

## `get_scan_status`

`{llm_endpoint, llm_model, total_scans, message}`. Health check for agents.

## `list_reports` / `get_scan` / `get_report_summary`

Report depot readers: newest-first HTML list; one persisted scan record by
agent name (`127.0.0.1_10702_mcp` style); record + file meta for one report
filename. Deletes go through REST (`DELETE /api/v1/reports/{file}`,
`DELETE /api/v1/scans/{agent}`) or the webapp.

## Skill resource

`skill://giskard-redteam/SKILL.md` — operator handbook (tools, profiles,
vendors, REST, workflows). Read it when the user needs workflow-level
guidance, not just one tool call.

## REST API (webapp backend, :11056)

Fleet-standard LLM surface (`/api/llm/...`, no `/v1`):

- `GET /api/llm/providers` — registry + live local detection + models.
- `GET /api/llm/models?provider=&endpoint=` — `{models, source:
  live|curated|none}` (Azure: enter the deployment name, no list API).
- `POST /api/llm/chat {provider, model, messages[], endpoint?}` and
  `POST /api/llm/chat/stream` (OpenAI-style SSE).
- `GET/POST /api/settings/llm`, `DELETE /api/settings/llm/key?provider=` —
  selection + write-only keys (GET returns `keys_configured` flags only).
- `GET /api/llm/gpus` (nvidia-smi VRAM), `GET /api/llm/onboarding`.

Scanner/depot surface (`/api/v1/...`):

- `POST /api/v1/scans {mcp_url, agent_description?, profiles?}` → **202 +
  `job_id`**. Poll `GET /api/v1/jobs/{job_id}` (`queued` → `detecting-llm` →
  `discovering-tools` → `scanning` → `complete`/`failed`); `DELETE` cancels.
- `GET /api/v1/scans`, `GET /api/v1/scans/{agent}`, `DELETE ...` — history.
- `GET /api/v1/reports`, `GET /api/v1/reports/{file}`, `.../summary`,
  `.../html`, `POST /api/v1/reports/compare {filenames[]}`, `DELETE ...`.
- `GET/POST/DELETE /api/v1/targets` — saved targets.
- `POST /api/v1/chat {messages[]}` — chat proxy, any vendor.
- `GET /api/v1/llm-models?provider=&url=` — model catalog per provider.
- `GET /api/v1/detect-llm`, `GET/PUT /api/v1/settings`, `GET /api/v1/jobs`,
  `GET /api/v1/diagnostics`, `GET /api/v1/discover`, `GET /api/v1/tools`.

## Scanning a repo: local or GitHub

This tool scans **live servers, not code**. A repo with a webapp is scanned
by running it first, then aiming at its MCP endpoint (the backend port's
`/mcp` — never the webapp port, never a bare host:port).

**Local checkout** (any fleet repo, e.g. `D:\Dev\repos\calibre-mcp`):

```powershell
cd D:\Dev\repos\calibre-mcp
.\start.ps1 -BackendOnly        # note its backend port, e.g. :10720
```

Then scan `http://127.0.0.1:10720/mcp` — via the Scans page, `run_fleet_scan`,
or `POST /api/v1/scans`. Give a real `agent_description` ("e-book library
with delete rights") — Giskard writes better attacks from it.

**GitHub repo**: clone it first, then it's a local checkout — same steps:

```powershell
git clone https://github.com/sandraschi/some-mcp.git
cd some-mcp
uv sync
$env:MCP_TRANSPORT = 'http'
uv run python -m some_mcp.server   # or its start.ps1; find the backend port
```

Then scan `http://127.0.0.1:<backend-port>/mcp`. If the repo exposes only
stdio (no HTTP), it can't be scanned yet — it needs an HTTP/SSE transport
first. If its tools take no free-text input (pure read-only getters), expect
validation noise rather than real findings — that's still signal about
strictness, but not vulnerabilities.

**Prove a fix**: scan → fix the target → rescan → `POST
/api/v1/reports/compare` with both filenames. The delta is the evidence.
