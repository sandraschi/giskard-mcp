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
  agent_name?: string;
  target: string;
  has_issues?: boolean;
  issue_count?: number;
  total_issues: number;
  tools_scanned: string | { name: string; description: string; tests_run: number; issues_found: number }[];
  issues: any[];
  report_path: string;
  error?: string;
}

export interface ScanRecord {
  agent_name: string;
  target: string;
  total_issues?: number;
  issues_found?: boolean;
  issue_count?: number;
  tools_scanned?: number | string;
  tools?: number | string;
  issues?: any[];
  profiles?: string[];
  tags?: string[];
  llm_model?: string;
  report_path: string;
  timestamp: string;
  error?: string;
}

export interface AppSettings {
  llm_url: string;
  llm_model: string;
  llm_provider?: string;
  llm_api_key?: string;
  llm_api_key_set?: boolean;
  target_mcp_url: string;
}

export interface DetectLlmInfo {
  success: boolean;
  url: string;
  provider: string;
  model: string;
  models: string[];
  endpoint_configured: string;
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

export interface ScanJob {
  job_id: string;
  status: string;
  target: string;
  profiles: string[];
  agent_name?: string;
  tools?: string;
  created: string;
  finished?: string;
  result?: ScanRecord;
  error?: string;
}

export interface SavedTarget {
  url: string;
  label: string;
  description: string;
}

export const api = {
  health: () => request<{ ok: boolean }>("/health"),
  status: () => request<StatusInfo>("/status"),
  diagnostics: () => request<DiagnosticsInfo>("/diagnostics"),
  detectLlm: () => request<DetectLlmInfo>("/detect-llm"),
  llmModels: (provider?: string, url?: string) => {
    const q = new URLSearchParams();
    if (provider) q.set("provider", provider);
    if (url) q.set("url", url);
    const qs = q.toString();
    return request<{ success: boolean; provider: string; models: string[]; note?: string; error?: string }>(
      `/llm-models${qs ? `?${qs}` : ""}`
    );
  },
  getSettings: async (): Promise<AppSettings> => {
    const raw = await request<AppSettings & { success?: boolean }>("/settings");
    const { success: _omit, ...settings } = raw;
    return settings as AppSettings;
  },
  saveSettings: (s: AppSettings) => request<{ success: boolean }>("/settings", { method: "PUT", body: JSON.stringify(s) }),

  scans: {
    list: () => request<{ success: boolean; scans: ScanRecord[]; total: number }>("/scans"),
    detail: (agent: string) => request<{ success: boolean; scan: ScanRecord }>(`/scans/${encodeURIComponent(agent)}`),
    run: (mcp_url: string, agent_description?: string, profiles?: string | string[]) =>
      request<{ success: boolean; job_id: string; status: string }>("/scans", {
        method: "POST",
        body: JSON.stringify({
          mcp_url,
          agent_description: agent_description || "",
          profiles: Array.isArray(profiles) ? profiles : (profiles || "").split(",").map((s) => s.trim()).filter(Boolean),
        }),
      }),
    remove: (agent: string) =>
      request<{ success: boolean; records_removed: number; files_removed: string[] }>(`/scans/${encodeURIComponent(agent)}`, {
        method: "DELETE",
      }),
  },

  jobs: {
    list: () => request<{ success: boolean; jobs: ScanJob[]; total: number }>("/jobs"),
    get: (job_id: string) => request<{ success: boolean; job: ScanJob }>(`/jobs/${encodeURIComponent(job_id)}`),
    cancel: (job_id: string) =>
      request<{ success: boolean; job: ScanJob }>(`/jobs/${encodeURIComponent(job_id)}`, { method: "DELETE" }),
  },

  targets: {
    list: () => request<{ success: boolean; targets: SavedTarget[]; total: number }>("/targets"),
    create: (url: string, label?: string, description?: string) =>
      request<{ success: boolean; targets: SavedTarget[]; message: string }>("/targets", {
        method: "POST",
        body: JSON.stringify({ url, label: label || "", description: description || "" }),
      }),
    remove: (url: string) =>
      request<{ success: boolean; targets: SavedTarget[] }>("/targets", {
        method: "DELETE",
        body: JSON.stringify({ url }),
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
    remove: (filename: string) =>
      request<{ success: boolean; file_removed: boolean; records_removed: number }>(`/reports/${encodeURIComponent(filename)}`, {
        method: "DELETE",
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

  chat: (messages: { role: string; content: string }[]) =>
    request<{ success: boolean; content?: string; model?: string; provider?: string; error?: string }>("/chat", {
      method: "POST",
      body: JSON.stringify({ messages }),
    }),
};
