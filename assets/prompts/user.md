# Giskard Red-Team Node — User Guide

## Quick Start

### Scan an Agent
1. Tell the assistant: *"Scan the adjudicator agent for vulnerabilities"*
2. Provide a description: *"It evaluates code submissions for security compliance"*
3. The assistant runs `run_red_team_scan` with those parameters

### Check Past Results
Ask: *"Show me my scan history"* or *"List the last 5 scans"*

### Get Status
Ask: *"What is the current server status?"*

## Example Workflows

### Security Audit
```
User: Scan my conversation instigator agent. It starts discussions and assigns tasks to other agents.
Assistant: [runs run_red_team_scan with agent "instigator"]
```

### Compare Multiple Agents
```
User: Run scans on both the instigator and the adjudicator, then compare their vulnerability profiles.
```

## Common Tasks

| Task | Tool | Parameters |
|------|------|------------|
| Run a scan | `run_red_team_scan` | `agent_name`, `agent_description` |
| List history | `list_scans` | `limit` (optional) |
| Check status | `get_scan_status` | None |

## Troubleshooting

- **"Scanner module not found"**: Run `uv sync` to install the project dependencies.
- **Scan fails with connection error**: Ensure the target agent is running and reachable at the configured API base URL. Check `GISKARD_AGENT_API_BASE`.
- **Giskard LLM errors**: If running air-gapped, configure `GISKARD_LLM_API_URL` to point at a local model (e.g., Ollama at `http://localhost:11434/v1`). If using OpenAI, set `GISKARD_LLM_API_KEY` or `OPENAI_API_KEY`.
