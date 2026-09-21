# Architecture

## Transports

Three ways in, one reason each:

- **stdio** (`MCP_TRANSPORT=stdio`, default) — Claude Desktop lane. 6 tools.
- **Streamable HTTP `/mcp`** — mounted in the Starlette app at `/mcp`
  (inner `http_app(path="/")`, parent passes its lifespan). This is what
  fleet siblings expose, and what the scanner speaks.
- **REST `/api/v1/...`** — the webapp backend (jobs, depot, settings, chat).

The scanner speaks **both** MCP client transports: Streamable HTTP first,
legacy SSE fallback. Target URLs look like
`http://127.0.0.1:10702/mcp` — backend port + `/mcp`, never the webapp port.

## Scan flow

```
POST /api/v1/scans ──→ 202 {job_id} ──→ asyncio task
  detecting-llm → discovering-tools → scanning (to_thread) → complete
       │                  │                    │
  detect_llm_details  fetch_tools_from_mcp  giskard.scan(only=tags)
  + saved settings    (dual transport)      predict() routes attacks
                                            through target tools,
                                            mapped onto text fields
```

`giskard.scan` is blocking, so jobs run it in `asyncio.to_thread` — the
event loop stays alive for polling/cancel. Cancel marks `cancelling`;
the worker thread finishes silently and its result is discarded.

## Eval LLM plumbing

`_resolve_llm()`: cloud vendors use saved provider/model/key (no detection
needed); local vendors prefer live detection for the URL, saved settings
for the model. `configure_giskard_llm()` calls Giskard's `set_llm_model`
(`openai/<m>` + `api_base` for local, vendor prefixes + keys for cloud)
with structured output off. Chat (`POST /api/v1/chat`) goes through
litellm directly with up to 3 model fallbacks. Keys never leave the backend.

## Depot

`reports/` holds HTML reports + `scans_index.json` (history) +
`targets.json` (saved targets), all atomic tmp+replace writes.
`SCANS_STORE` is the in-memory working copy, hydrated on boot.
`src/giskard_mcp/app_settings.json` holds Settings (key server-side only).

## Ports and protocols

Backend **11056** (REST + `/mcp` + `/health`), frontend **11057**.
Discover range 10700–11500 via `/health` probes (concurrent, ~5s fleet-wide).
