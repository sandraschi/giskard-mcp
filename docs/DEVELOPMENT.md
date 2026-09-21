# Development Setup

## Tools Required

Install all of these before continuing:

```bash
# Windows (winget)
winget install astral-sh.uv
winget install Git.Git
winget install OpenJS.NodeJS
winget install Casey.Just

# Verify
uv --version
git --version
node --version
just --version
```

Frontend additionally needs Bun (`irm bun.sh/install.ps1 | iex` — see
`webapp/frontend` docs) or npm.

## Setup

```bash
git clone https://github.com/sandraschi/giskard-mcp
cd giskard-mcp
uv sync
cd webapp/frontend && bun install
```

## Common Tasks

```bash
uv run ruff check src/        # lint
uv run ruff format src/       # format
uv run pytest                 # tests (suite is empty — contributions welcome)
cd webapp/frontend && bun run tsc --noEmit   # frontend types
cd webapp/frontend && bun run build           # rebuild served dist/
```

`.\start.ps1` runs backend (:11056) + frontend (:11057). Backend alone:

```powershell
$env:MCP_TRANSPORT = 'http'
uv run python -m giskard_mcp.server
```

## Code Standards

- Portmanteau MCP tools, `success`/`error` return shapes, no stubs.
- Batch edits of 3+ files need timestamped `.bak` copies first.
- Never hardcode ports; never commit `reports/`, `data/`, `.env`.
- Fleet standards: `mcp-central-docs/standards/` (README structure, tool
  design, webapp SOTA). Prove changes by running them: ruff + tsc + a live
  endpoint smoke test before calling anything done.

## Architecture pointers

See [ARCHITECTURE.md](ARCHITECTURE.md) for transports, background jobs, the
report depot, and the vendor/LLM plumbing before touching `scanner.py`.
