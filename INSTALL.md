# Installing giskard-mcp

## Prerequisites

Install these if you don't have them already:

| Tool | Purpose | Install |
|------|---------|---------|
| Claude Desktop | Required host | [download](https://claude.ai/download) |
| Git | Clone repo (Option C/D only) | `winget install Git.Git` |
| Python + uv | Run server (Option C/D only) | `winget install astral-sh.uv` |
| Node.js | mcpb CLI (Option B only) | `winget install OpenJS.NodeJS` |
| LM Studio **or** Ollama | Free local LLM judge (recommended) | [lmstudio.ai](https://lmstudio.ai) or `winget install Ollama.Ollama` |

> Windows: all installs via [winget](https://learn.microsoft.com/en-us/windows/package-manager/winget/)
> macOS: use `brew install` equivalents
> Linux: use your distro package manager

You also need **an LLM for the security judges**: either a local one (LM
Studio with its API server on, or Ollama — both free, no keys) or a cloud
key (OpenAI / Anthropic / Azure, entered in Settings). Details:
[docs/ONBOARDING.md](docs/ONBOARDING.md).

## Option A — Drag and Drop (Recommended)

1. Go to [Releases](https://github.com/sandraschi/giskard-mcp/releases/latest)
2. Download `giskard-mcp-{version}.mcpb`
3. Open Claude Desktop → drag the file onto the window
   *Or*: Settings → MCP Servers → Install from file

## Option B — mcpb CLI

```bash
# Requires Node.js (see Prerequisites)
npx @anthropic-ai/mcpb install https://github.com/sandraschi/giskard-mcp
```

## Option C — Manual Configuration

1. Clone: `git clone https://github.com/sandraschi/giskard-mcp`
2. Install deps: `cd giskard-mcp && uv sync`
3. Add to Claude Desktop config:

```json
{
  "mcpServers": {
    "giskard": {
      "command": "uv",
      "args": ["run", "--directory", "C:\\path\\to\\giskard-mcp", "python", "-m", "giskard_mcp.server"],
      "env": { "PYTHONUNBUFFERED": "1" }
    }
  }
}
```

Config file location:
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`

4. Restart Claude Desktop

## Option D — Developer Mode (webapp)

```powershell
git clone https://github.com/sandraschi/giskard-mcp
cd giskard-mcp
uv sync
.\start.ps1   # backend :11056, frontend :11057, opens browser
```

For contributing or running from source with live reload.
See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Verify Installation

After installing, open Claude Desktop and type:
> "List the fleet servers you can see."

You should see: a list of discovered MCP servers (or an empty list with a
total of 0 if nothing else is running — that still proves the wiring works).

Then: Settings → pick your LLM → Chat → say hi.

## Troubleshooting

See [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) for common issues
(no LLM detected, `Cannot list tools`, ConPTY pipe teardown `0x800700e8`).
