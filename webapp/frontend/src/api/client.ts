const API_BASE = "/api/v1";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export interface ScanResult {
  success: boolean;
  target: string;
  total_issues: number;
  tools_scanned: { name: string; description: string; tests_run: number; issues_found: number }[];
  issues: any[];
  report_path: string;
  error?: string;
}

export interface ScanRecord {
  agent_name: string;
  target: string;
  total_issues: number;
  issues_found?: boolean;
  issue_count?: number;
  tools_scanned: number;
  report_path: string;
  timestamp: string;
  error?: string;
}

export interface AppSettings {
  llm_url: string;
  llm_model: string;
  target_mcp_url: string;
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  annotations: Record<string, unknown>;
}

export interface ReportInfo {
  filename: string;
  size: number;
  modified: string;
}

export interface SkillInfo {
  name: string;
  uri: string;
}

export interface FleetServer {
  port: number;
  url: string;
  ok: boolean;
  service: string;
  mcp_available: boolean;
}

export interface StatusInfo {
  ok: boolean;
  llm_endpoint: string;
  total_scans: number;
  reports_dir: string;
}

export interface DiagnosticsInfo {
  ok: boolean;
  service: string;
  version: string;
  uptime_seconds: number;
  port: number;
  total_scans: number;
  reports_available: number;
  lm_studio_detected: boolean;
  llm_endpoint_configured: string;
}

export const api = {
  health: () => request<{ ok: boolean }>("/health"),
  status: () => request<StatusInfo>("/status"),
  diagnostics: () => request<DiagnosticsInfo>("/diagnostics"),
  detectLlm: () => request<{ success: boolean; url: string; model: string }>("/detect-llm"),
  getSettings: () => request<AppSettings>("/settings"),
  saveSettings: (s: AppSettings) => request<{ success: boolean }>("/settings", { method: "PUT", body: JSON.stringify(s) }),

  scans: {
    list: () => request<{ success: boolean; scans: ScanRecord[]; total: number }>("/scans"),
    detail: (agent: string) => request<{ success: boolean; scan: ScanRecord }>(`/scans/${encodeURIComponent(agent)}`),
    run: (mcp_url: string, profiles?: string) =>
      request<ScanResult>("/scans", {
        method: "POST",
        body: JSON.stringify({ mcp_url, profiles: profiles || "prompt_injection,information_disclosure" }),
      }),
  },

  discover: () => request<{ success: boolean; servers: FleetServer[]; total: number }>("/discover"),

  reports: {
    list: () => request<{ success: boolean; reports: ReportInfo[] }>("/reports"),
    url: (filename: string) => `${API_BASE}/reports/${encodeURIComponent(filename)}`,
    summary: (filename: string) => request<{ success: boolean; scan?: ScanRecord }>(`/reports/${encodeURIComponent(filename)}/summary`),
    html: (filename: string) => request<{ success: boolean; html: string; filename: string }>(`/reports/${encodeURIComponent(filename)}/html`),
    compare: (filenames: string[]) =>
      request<{ success: boolean; scans: ScanRecord[] }>("/reports/compare", {
        method: "POST",
        body: JSON.stringify({ filenames }),
      }),
  },

  tools: {
    list: () => request<{ success: boolean; tools: ToolDef[]; total: number }>("/tools"),
  },

  skills: {
    list: () => request<{ success: boolean; skills: SkillInfo[] }>("/skills"),
    get: (name: string) =>
      request<{ success: boolean; name: string; content: string }>(`/skills/${encodeURIComponent(name)}`),
  },
};
