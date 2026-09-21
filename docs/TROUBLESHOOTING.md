# Troubleshooting

## Provider shows Not found but the engine is running

**Cause**: `localhost` vs `127.0.0.1` mismatch (observed: `localhost:1234`
404s while `127.0.0.1:1234` works — IPv6 trap on Windows).
**Fix**: The registry already uses `127.0.0.1` for all local engines. If a
custom endpoint misbehaves, retry it with the literal IPv4 address.

## Model dropdown empty for a cloud vendor

**Cause**: No key saved yet — unkeyed vendors only show curated names, and
an empty curated list (Azure) shows the text field.
**Fix**: Save the key in the provider card first, then Refresh. Azure never
has a list: type the deployment name.

## No LLM configured (scan fails immediately)

**Cause**: No LM Studio/Ollama running and no vendor model + key saved.
**Fix**: See [ONBOARDING.md](ONBOARDING.md) — start LM Studio's API server
(port 1234) or Ollama (11434), then Settings → Re-detect → pick model → Save.
Or save a cloud vendor model + key.

## Cannot list tools at .../mcp

**Cause**: Target down, wrong port/path, or an exotic transport.
**Fix**: The URL must be the backend's MCP endpoint (`.../mcp`), not the
webapp port. The client tries Streamable HTTP then legacy SSE. Verify with
`GET http://HOST:PORT/health` first, or `list_fleet_servers()` to discover.

## Scan returns only CALL_ERROR / validation errors

**Cause**: The target's tools take no free-text input (or the attack text
lands in a field the schema rejects).
**Fix**: Attacks are mapped onto the most plausible text field (`prompt` >
`query` > `text` > ...). Read-only getters mostly yield validation noise —
informative about strictness, not vulnerabilities. Scan the tools that take
real input.

## Failed to load model (LM Studio)

**Cause**: Model not downloaded or too big for VRAM.
**Fix**: Pick a smaller downloaded model (7–8b class) in Settings.

## Judge scores nothing / empty issues on an obviously evil target

**Cause**: An embedding model (`*embed*`) was picked as judge — it can't
generate or grade.
**Fix**: Pick a chat model. Auto-pick already skips `*embed*` names.

## Report exists on disk but Scans list is empty

**Cause**: Pre-persistence versions kept history only in RAM.
**Fix**: Current versions persist to `reports/scans_index.json`. If you
upgraded mid-stream, rescan — old RAM-only history is gone.

## Chat says "No LLM configured"

**Cause**: Provider/model not saved yet.
**Fix**: Settings → pick provider + model (+ key for cloud) → Save → chat.

## Frontend shows "Offline"

**Cause**: Backend not running or wrong port.
**Fix**: `.\start.ps1` (backend :11056). In Tauri, use the Restart Backend
button in Settings. Check `http://127.0.0.1:11056/health`.

## ConPTY pipe teardown error (0x800700e8)

**Cause**: Fleet launcher console pipe teardown on Windows.
**Fix**: Run `start.ps1` from `cmd.exe /k`, or start backend/frontend
manually (`uv run python -m giskard_mcp.server` with `MCP_TRANSPORT=http`;
`bun run dev` in `webapp/frontend`).
