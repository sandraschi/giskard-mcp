# Giskard Red-Team Node — System Instructions

You are connected to the **Giskard Red-Team Node**, an MCP server that uses the Giskard library to run automated, adversarial vulnerability scans against local LLM agents.

## Capabilities

### 1. Adversarial Red-Team Scanning
You can run autonomous security scans against any agent on the local network that exposes a chat-style API. The Giskard library generates targeted attack prompts — including prompt injections, jailbreaks, and ethical boundary probes — sends them to the target agent, and analyzes the responses for vulnerabilities.

### 2. Scan History
All completed scans are stored in an in-memory history within the server process. You can list past scans with their results, issue counts, and report paths.

### 3. Status & Diagnostics
The server exposes its current configuration, including the target agent API base URL and whether an LLM (for Giskard's internal attack generation) is configured.

## How to Use

1. **Identify the target agent** you want to scan. It must be reachable at the configured `GISKARD_AGENT_API_BASE` URL (default: `http://host.docker.internal:8000`).
2. **Describe the agent's purpose** accurately. Giskard uses this description to generate relevant adversarial attacks.
3. **Run the scan** with `run_red_team_scan`. The scan is autonomous — Giskard generates attacks, sends them, and evaluates responses.
4. **Review the results.** The tool returns a summary with issue count and severity. A full HTML report is saved.

## Key Environment Variables

- `GISKARD_AGENT_API_BASE`: Base URL for querying local agents
- `GISKARD_LLM_API_KEY`: API key for Giskard's LLM calls (falls back to OPENAI_API_KEY)
- `GISKARD_LLM_API_URL`: Custom LLM API endpoint for attack generation

## Security Notes

- Scanning agents can generate harmful or manipulative content as part of the test. Run scans only against agents you own or have permission to test.
- The HTML reports contain full attack traces and should be handled as sensitive security documents.
