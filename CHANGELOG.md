# Changelog

## 0.2.0 — 2026-09-21

First real release. Breaking REST change: `POST /api/v1/scans` now returns
**202 + `job_id`** (was: synchronous `ScanResult`). Poll
`GET /api/v1/jobs/{id}`; `DELETE` cancels.

Added:

- Background scan jobs (202 + poll + cancel, blocking Giskard run in worker thread)
- Persisted depot: `scans_index.json` history + HTML reports survive restarts;
  `DELETE` for scans and reports
- Fleet-standard LLM surface: `/api/llm/*` (providers/models/chat/stream/
  gpus/onboarding/test), 0600 keystore, write-only keys
- Cloud vendors: OpenAI, Anthropic, Azure OpenAI (local LM Studio/Ollama
  auto-detected as before)
- Scan profiles that actually filter Giskard detectors (7 profiles → tags)
- Saved scan targets CRUD; schema-mapped attack fields; Streamable-HTTP +
  SSE dual transport; precise target errors (401/404/down)
- Skill resource `skill://giskard-redteam/SKILL.md`; full `docs/` stack;
  dashboard hero; provider cards + model catalog + streaming chat UI
- 39 pytest tests; ruff + tsc clean

Fixed along the way: broken `/mcp` mount (double prefix + missing
lifespan), `/reports/compare` route shadowing, `localhost`-vs-`127.0.0.1`
IPv6 trap, honest curated-model fallback, no-hijack key saves.

## 0.1.0 — initial scaffold
