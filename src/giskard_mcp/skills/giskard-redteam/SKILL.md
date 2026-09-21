# Giskard Red-Team Skill

## Overview

Giskard Red-Team Node is a fleet vulnerability scanner. It wraps any MCP
server as a Giskard `text_generation` model, fires adversarial prompts at it
(prompt injection, jailbreaks, data leakage, harmful content, ...), grades the
responses with an LLM judge, and stores traceable issues plus a full HTML
report per scan. Scans run as background jobs; history and reports persist
across restarts in `reports/`.

REST API at `127.0.0.1:11056` (`/api/v1/...`), webapp on `:11057`.

## MCP Tools

- `run_fleet_scan(mcp_url, agent_description="", profiles="")` — Full scan
  pipeline: detect LLM, list target tools, run Giskard, persist record +
  HTML report. `profiles` is a comma-separated subset (empty = full suite).
  Returns `{success, agent_name, issues_found, issue_count, issues,
  profiles, report_path}`.
- `list_fleet_servers(limit=50)` — Probe ports 10700-11500 for `/health`,
  returns `{port, url, service, ok, mcp_available}`.
- `get_scan_status()` — `{llm_endpoint, llm_model, total_scans}`.
- `list_reports(limit=20)` — HTML reports on disk, newest first.
- `get_scan(agent_name)` — One persisted scan record with issues.
- `get_report_summary(filename)` — Scan record + file meta for one report.

Agent name convention: the MCP URL with `://`, `/`, `:` replaced by `_`,
e.g. `http://127.0.0.1:10702/mcp` becomes `127.0.0.1_10702_mcp`.

## Scan Profiles (what each one actually runs)

Profiles map to Giskard detector tags passed as `giskard.scan(only=[...])`:

- `prompt_injection` — injection + jailbreak detectors
- `information_disclosure` — disclosure + data-leakage detectors
- `harmful_content` — harmfulness detectors
- `hallucination` — hallucination / faithfulness / misinformation
- `bias` — ethical-bias / stereotypes / discrimination
- `boundary_testing` — robustness / control-chars / text-perturbation
- `role_play` — jailbreak detectors (role-play attacks)
- empty / omitted — the full detector suite

## LLM Vendors (judges + chat)

Provider is set in Settings and stored server-side. Key precedence:
Settings value > vendor env var > none. Keys never leave the backend.

- `lm-studio` / `ollama` / `custom` / `local` — OpenAI-compatible endpoint,
  no key. Auto-detected (`:1234`, `:11434`); model dropdown lists found
  models. Embedding models are skipped when picking a default.
- `openai` — needs model (e.g. `gpt-4o-mini`) + key (`OPENAI_API_KEY`).
- `anthropic` — needs model (e.g. `claude-sonnet-4-0`) + key
  (`ANTHROPIC_API_KEY`).
- `azure` — needs endpoint URL + deployment name as model + key
  (`AZURE_API_KEY`, optional `AZURE_API_VERSION`, default `2024-02-01`).

Giskard judges are configured via `set_llm_model` with structured output
off (local models lack JSON mode; evaluators repair-parse text).

## REST API

- `POST /api/v1/scans {mcp_url, agent_description?, profiles?}` — returns
  **202 + `job_id`** immediately. Poll `GET /api/v1/jobs/{job_id}` until
  `complete` / `failed`; `DELETE` the job to cancel.
- `GET /api/v1/scans`, `GET /api/v1/scans/{agent}`,
  `DELETE /api/v1/scans/{agent}` — history CRUD (delete also removes the
  orphaned report file).
- `GET /api/v1/reports`, `GET /api/v1/reports/{file}`,
  `GET .../summary`, `GET .../html`, `POST /api/v1/reports/compare`,
  `DELETE /api/v1/reports/{file}` — report depot CRUD.
- `GET/POST/DELETE /api/v1/targets` — saved scan targets `{url, label,
  description}`.
- `POST /api/v1/chat {messages[]}` — chat proxy, any vendor, keys stay
  server-side. Falls back across up to 3 model candidates.
- `GET /api/v1/llm-models?provider=&url=` — model catalog for the active
  provider (local detection, vendor APIs with the stored key, or the custom
  endpoint's `/models`). Azure has no list API — enter the deployment name.
- `GET /api/v1/detect-llm`, `GET/PUT /api/v1/settings`, `GET /api/v1/jobs`,
  `GET /api/v1/diagnostics`, `GET /api/v1/discover`.

## Best Practices

1. Start with `list_fleet_servers()` (or the Scans page Discover) — never
   guess ports; the fleet moves.
2. Make sure an LLM is configured first: local LM Studio/Ollama for free
   judges, or a vendor key. Scans fail fast with a clear error otherwise.
3. Scope with `profiles` for quick iterations (`prompt_injection` first),
   run the full suite before signing anything off.
4. After fixing a target, rescan and `POST /api/v1/reports/compare` with
   both filenames to prove the delta.
5. Long scans are normal (minutes) — poll the job, don't block; cancel via
   `DELETE /api/v1/jobs/{id}` if the target is wrong.
6. Reports are evidence: link `report_path`, quote `issue_count` and the
   `group`/`severity` of each issue, never paraphrase away the severity.

## Configuration

- `GISKARD_MCP_PORT` (default 11056), `GISKARD_MCP_HOST`, `MCP_TRANSPORT`
  (`stdio` for Claude Desktop, `http` for the webapp backend).
- `GISKARD_LLM_API_URL`, `GISKARD_LLM_MODEL` defaults; `FLEET_PORT_START/END`
  (default 10700-11500); `GISKARD_SCAN_TIMEOUT`.
- Vendor keys: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `AZURE_API_KEY`,
  `AZURE_API_VERSION`.

## Troubleshooting

- `Cannot list tools at <url>` — target down, wrong path (needs the
  backend's `/mcp`, not the webapp port and not a bare host:port), or a
  transport this client doesn't speak (tries Streamable HTTP, then SSE).
- Attacks land in the tool's most plausible text field (`prompt` > `query`
  > `text` > ...); read-only tools with no text input mostly return
  validation noise, which still counts as signal (strict rejection).
- `No LLM configured` — start LM Studio with its API server on (port 1234)
  or Ollama (11434), or save a vendor model + key.
- Embedding model picked as judge (judges score nothing) — pick a chat
  model in Settings; the UI skips `*embed*` defaults automatically.
- `Failed to load model` from LM Studio — the model isn't downloaded or
  doesn't fit VRAM; pick a smaller one (7-8b class).
- Stale `CANCELLED` jobs — the worker thread finishes silently and the
  result is discarded; harmless.
