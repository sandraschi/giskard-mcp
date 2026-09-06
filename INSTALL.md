# Install

## Prerequisites

- Python 3.11+
- uv (`pip install uv` or `scoop install uv`)
- Docker (optional, for containerized runs)
- Access to target agents on your local network

## Install

```powershell
git clone https://github.com/sandraschi/giskard-mcp.git
cd giskard-mcp
uv sync
```

## Run

```powershell
# stdio MCP server (for Claude Desktop, Cursor, etc.)
uv run python -m giskard_mcp.server

# Docker
docker build -t giskard-mcp .
docker run --rm -i giskard-mcp
```

## Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "giskard": {
      "command": "uv",
      "args": ["run", "--directory", "D:/Dev/repos/giskard-mcp", "python", "-m", "giskard_mcp.server"]
    }
  }
}
```
