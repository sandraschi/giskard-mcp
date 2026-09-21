const API_BASE = "/api";

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

export type ProviderKind = "local" | "cloud";
export type ModelSource = "live" | "curated" | "none";
export type ProviderStatus = "probing" | "detected" | "not_found";

export interface ProviderInfo {
  id: string;
  label: string;
  kind: ProviderKind;
  base_url: string;
  needs_key: boolean;
  key_env: string | null;
  configured: boolean;
  detected?: boolean;
  models?: string[];
}

export interface ModelsResponse {
  provider: string;
  models: string[];
  source: ModelSource;
  note?: string;
  error?: string;
}

export interface GpuInfo {
  index: number;
  name: string;
  total_mb: number;
  used_mb: number;
  free_mb: number;
}

export interface OnboardingState {
  locals: Array<{ id: string; label: string; port: number | null }>;
  clouds_configured: string[];
  recommendation: { path: string; reason: string };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const PROVIDER_KEY = "llm_provider";
const MODEL_KEY = "llm_model";
const GPU_KEY = "llm_gpu";
const ONBOARDED_KEY = "llm_onboarded";

function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* quota */
  }
}

export function loadSelection(): { provider: string; model: string } {
  return {
    provider: storageGet(PROVIDER_KEY) || "",
    model: storageGet(MODEL_KEY) || "",
  };
}

export function saveSelection(provider: string, model: string) {
  storageSet(PROVIDER_KEY, provider);
  storageSet(MODEL_KEY, model);
  try {
    window.dispatchEvent(
      new CustomEvent(SELECTION_EVENT, { detail: { provider, model } }),
    );
  } catch {
    /* non-DOM */
  }
}

const SELECTION_EVENT = "llm-selection-changed";

export type Selection = { provider: string; model: string };

/** Live-sync hook: fires when any tab/page saves a new LLM selection. */
export function subscribeSelection(cb: (sel: Selection) => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === PROVIDER_KEY || e.key === MODEL_KEY) cb(loadSelection());
  };
  const onCustom = (e: Event) => {
    const d = (e as CustomEvent).detail as Selection | undefined;
    if (d && typeof d.provider === "string" && typeof d.model === "string")
      cb({ provider: d.provider, model: d.model });
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(SELECTION_EVENT, onCustom);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(SELECTION_EVENT, onCustom);
  };
}

export function loadGpuIndex(): number {
  const raw = storageGet(GPU_KEY);
  const n = raw === null ? NaN : Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : 0;
}

export function saveGpuIndex(index: number) {
  storageSet(GPU_KEY, String(index));
}

export function isOnboarded(): boolean {
  return storageGet(ONBOARDED_KEY) === "1";
}

export function markOnboarded() {
  storageSet(ONBOARDED_KEY, "1");
}

export function fetchProviders(): Promise<{ providers: ProviderInfo[] }> {
  return request<{ providers: ProviderInfo[] }>("/llm/providers");
}

export function fetchModels(provider: string, endpoint?: string): Promise<ModelsResponse> {
  const qs =
    `?provider=${encodeURIComponent(provider)}` +
    (endpoint ? `&endpoint=${encodeURIComponent(endpoint)}` : "");
  return request<ModelsResponse>(`/llm/models${qs}`);
}

export interface TestResult {
  success: boolean;
  ok: boolean;
  provider: string;
  models: string[];
  source: ModelSource;
  note?: string;
  error?: string;
}

/** Validate a provider without saving: typed keys go in the POST body only. */
export function testProvider(provider: string, apiKey?: string, endpoint?: string): Promise<TestResult> {
  return request<TestResult>("/llm/test", {
    method: "POST",
    body: JSON.stringify({
      provider,
      ...(apiKey ? { api_key: apiKey } : {}),
      ...(endpoint ? { endpoint } : {}),
    }),
  });
}

export function fetchOnboarding(): Promise<OnboardingState> {
  return request<OnboardingState>("/llm/onboarding");
}

export async function fetchGpus(): Promise<GpuInfo[]> {
  try {
    const d = await request<{ gpus?: GpuInfo[] }>("/llm/gpus");
    return d.gpus ?? [];
  } catch {
    return [];
  }
}

export function saveLlmSettings(body: {
  provider: string;
  endpoint?: string;
  model: string;
  api_key?: string;
}): Promise<{ success: boolean; key_saved?: boolean }> {
  return request("/settings/llm", { method: "POST", body: JSON.stringify(body) });
}

export function fetchLlmSettings(): Promise<{
  provider: string;
  endpoint: string;
  model: string;
  keys_configured: Record<string, boolean>;
}> {
  return request("/settings/llm");
}

export function deleteLlmKey(provider: string): Promise<{ success: boolean; removed: boolean }> {
  return request(`/settings/llm/key?provider=${encodeURIComponent(provider)}`, {
    method: "DELETE",
  });
}

export async function chatComplete(
  provider: string,
  model: string,
  messages: ChatMessage[],
  endpoint?: string,
): Promise<string> {
  const d = await request<{ success: boolean; content?: string; error?: string }>("/llm/chat", {
    method: "POST",
    body: JSON.stringify({ provider, model, messages, endpoint: endpoint || undefined }),
  });
  if (typeof d.content !== "string") throw new Error(d.error || "Empty chat response");
  return d.content;
}

/** Stream assistant tokens via SSE; calls onToken per delta. Falls back to non-stream. */
export async function streamChat(
  provider: string,
  model: string,
  messages: ChatMessage[],
  onToken: (text: string) => void,
  signal?: AbortSignal,
  endpoint?: string,
): Promise<void> {
  let r: Response;
  try {
    r = await fetch(`${API_BASE}/llm/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, model, messages, endpoint: endpoint || undefined }),
      signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return;
    throw e;
  }
  if (!r.ok || !r.body) {
    const text = await chatComplete(provider, model, messages, endpoint);
    onToken(text);
    return;
  }
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]" || payload === "") continue;
      try {
        const chunk = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const text = chunk.choices?.[0]?.delta?.content ?? "";
        if (text) onToken(text);
      } catch {
        /* keep-alive or partial frame */
      }
    }
  }
}

/** First chat-capable model: skip embedding catalog noise. */
export function pickChatModel(models: string[]): string {
  for (const m of models) {
    if (!/embed/i.test(m)) return m;
  }
  return models[0] ?? "";
}
