# Giskard RedTeam Node (`giskard-mcp`)

**Automated adversarial red-teaming scans against local AI agents.**

An MCP server that wraps [Giskard](https://github.com/Giskard-AI/giskard) to run
adversarial vulnerability scans against any agent on your local network. Reports
include attack traces, detected vulnerabilities, and an HTML summary.

## Quick Start

```bash
# Install dependencies
uv sync

# Run (stdio MCP server)
uv run python -m giskard_mcp.server

# Or via Docker
docker build -t giskard-mcp .
docker run --rm -i giskard-mcp
```

## Configuration

| Env Var | Default | Description |
|---|---|---|
| `GISKARD_AGENT_BASE_URL` | `http://goliath.local:8000` | Base URL for target agents |
| `GISKARD_AGENT_API_KEY` | `` | Optional bearer token |
| `GISKARD_LLM_API_BASE` | `http://goliath.local:11434/v1` | LLM for Giskard attack generation |
| `GISKARD_LLM_API_KEY` | `ollama` | LLM API key |
| `GISKARD_REPORT_DIR` | `/app/reports` | Output directory for HTML reports |

## Tool

- `run_vulnerability_scan` -- Run a full Giskard scan against an agent by name.
  Provide the agent name and a description of its capabilities for targeted attacks.

## Ports

Registered in fleet: **11056** (MCP / future backend), **11057** (future frontend).

## License

MIT
