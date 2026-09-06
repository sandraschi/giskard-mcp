import os
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Settings:
    host: str = field(default_factory=lambda: os.environ.get("GISKARD_MCP_HOST", "127.0.0.1"))
    port: int = field(default_factory=lambda: int(os.environ.get("GISKARD_MCP_PORT", "11056")))
    mcp_http_path: str = field(default_factory=lambda: os.environ.get("GISKARD_MCP_HTTP_PATH", "/mcp"))
    transport: str = field(default_factory=lambda: os.environ.get("MCP_TRANSPORT", "stdio"))

    llm_api_url: str = field(default_factory=lambda: os.environ.get("GISKARD_LLM_API_URL", "http://127.0.0.1:1234/v1"))
    llm_api_key: str = field(default_factory=lambda: os.environ.get("GISKARD_LLM_API_KEY", "not-needed"))
    llm_model: str = field(default_factory=lambda: os.environ.get("GISKARD_LLM_MODEL", ""))

    target_mcp_url: str = field(default_factory=lambda: os.environ.get("GISKARD_TARGET_MCP_URL", ""))
    reports_dir: str = field(default_factory=lambda: os.environ.get("GISKARD_REPORTS_DIR", "/app/reports"))
    fleet_port_start: int = field(default_factory=lambda: int(os.environ.get("GISKARD_FLEET_PORT_START", "10700")))
    fleet_port_end: int = field(default_factory=lambda: int(os.environ.get("GISKARD_FLEET_PORT_END", "11500")))

    @property
    def local_reports_dir(self) -> str:
        reports = Path(self.reports_dir)
        if reports.is_dir():
            return str(reports)
        local = Path(__file__).resolve().parent.parent.parent / "reports"
        local.mkdir(parents=True, exist_ok=True)
        return str(local)


settings = Settings()
