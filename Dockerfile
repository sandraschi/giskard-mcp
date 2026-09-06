FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY src/ src/

RUN mkdir -p /app/reports

# Default: stdio mode for Claude Desktop / MCP client
# Override with -e GISKARD_PORT=11056 for HTTP mode
ENTRYPOINT ["python", "-m", "giskard_mcp.server"]
