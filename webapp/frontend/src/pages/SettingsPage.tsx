import { useCallback, useEffect, useState } from "react";
import {
  FlaskConical, Globe, Key, Loader2, RefreshCw, Save, Server, Target, Wifi,
} from "lucide-react";
import { api, type AppSettings } from "../api/client";

export function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings>({
    llm_url: "http://127.0.0.1:1234/v1",
    llm_model: "",
    llm_provider: "",
    target_mcp_url: "",
  });
  const [llmOk, setLlmOk] = useState<boolean | null>(null);
  const [provider, setProvider] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [catalog, setCatalog] = useState<string[]>([]);
  const [catalogNote, setCatalogNote] = useState("");
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [keySaved, setKeySaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [backendOk, setBackendOk] = useState<boolean | null>(null);

  const checkHealth = useCallback(async () => {
    try {
      const h = await api.health();
      setBackendOk(h.ok);
    } catch { setBackendOk(false); }
  }, []);

  const loadCatalog = useCallback(async (prov: string, url: string) => {
    setCatalogLoading(true);
    setCatalogNote("");
    try {
      const data = await api.llmModels(prov, url);
      setCatalog(data.models || []);
      if (data.note) setCatalogNote(data.note);
      else if (!data.success && data.error) setCatalogNote(data.error);
    } catch {
      setCatalog([]);
    }
    setCatalogLoading(false);
  }, []);

  const load = useCallback(async () => {
    try {
      const [s, d] = await Promise.all([api.getSettings(), api.detectLlm()]);
      const prov = s.llm_provider || d.provider || "";
      setSettings({
        llm_url: s.llm_url,
        llm_model: s.llm_model || d.model || "",
        llm_provider: prov,
        target_mcp_url: s.target_mcp_url,
      });
      setKeySaved(!!s.llm_api_key_set);
      setLlmOk(d.success);
      setProvider(d.provider || "");
      setModels(d.models || []);
      await loadCatalog(prov, s.llm_url);
    } catch { await checkHealth(); }
  }, [checkHealth, loadCatalog]);

  const detectNow = useCallback(async () => {
    setLlmOk(null);
    try {
      const d = await api.detectLlm();
      setLlmOk(d.success);
      setProvider(d.provider || "");
      setModels(d.models || []);
      const cloud = ["openai", "anthropic", "azure"].includes(settings.llm_provider || "");
      const prov = cloud ? settings.llm_provider || "" : d.provider;
      if (!cloud && d.success) {
        setSettings((p) => ({
          ...p,
          llm_url: d.url || p.llm_url,
          llm_provider: d.provider,
          llm_model: p.llm_model || d.model || "",
        }));
      }
      await loadCatalog(prov, cloud ? settings.llm_url : "");
    } catch { setLlmOk(false); }
  }, [loadCatalog, settings.llm_provider, settings.llm_url]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await api.saveSettings({ ...settings, llm_api_key: apiKey });
      setKeySaved(!!(res as { settings?: { llm_api_key_set?: boolean } }).settings?.llm_api_key_set || (keySaved && !apiKey));
      setApiKey("");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {}
    setSaving(false);
  };

  const activeProvider = settings.llm_provider || provider;
  const isCloud = ["openai", "anthropic", "azure"].includes(activeProvider);

  const restartBackend = useCallback(async () => {
    setRestarting(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("start_backend");
    } catch { /* not in Tauri */ }
    setTimeout(async () => {
      await checkHealth();
      setRestarting(false);
    }, 5000);
  }, [checkHealth]);

  // Listen for Tauri backend-status event
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen<string>("backend-status", (event) => {
          if (event.payload === "ready") { checkHealth(); }
          else if (typeof event.payload === "string" && event.payload.startsWith("error:")) { setBackendOk(false); }
        });
      } catch { /* not in Tauri */ }
    })();
    return () => { if (unlisten) unlisten(); };
  }, [checkHealth]);

  return (
    <div>
      <h1 className="text-2xl font-bold text-zinc-100 mb-6 flex items-center gap-2">
        <Server className="text-amber-500" size={24} />
        Settings
      </h1>

      <div className="space-y-4 max-w-2xl">
        {/* Backend status + restart */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className={`w-2.5 h-2.5 rounded-full ${backendOk === null ? "bg-zinc-500" : backendOk ? "bg-green-500" : "bg-red-500"}`} />
            <div>
              <p className="text-sm text-zinc-200">Backend</p>
              <p className="text-xs text-zinc-500">{backendOk === null ? "Checking..." : backendOk ? "Connected" : "Offline"}</p>
            </div>
          </div>
          {backendOk === false && (
            <button onClick={restartBackend} disabled={restarting} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-700 text-black font-medium transition-colors">
              {restarting ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              {restarting ? "Restarting..." : "Restart Backend"}
            </button>
          )}
        </div>

        {/* LLM Provider */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-zinc-300 flex items-center gap-2">
              <FlaskConical size={16} className="text-amber-500" />
              LLM Provider - attack generation + chat
            </h2>
            <button onClick={detectNow} data-testid="llm-redetect" className="flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-zinc-800 text-zinc-300 hover:text-zinc-200">
              <RefreshCw size={10} /> Re-detect
            </button>
          </div>

          {llmOk && (
            <div className="mb-3 p-3 rounded-lg bg-green-500/5 border border-green-500/20 text-xs text-green-400">
              <div className="flex items-center gap-1.5 font-medium mb-1">
                <Wifi size={12} /> {provider === "lm-studio" ? "LM Studio detected on :1234" : provider === "ollama" ? "Ollama detected on :11434" : `Provider detected: ${provider}`}
              </div>
              {models.length > 0 && <p className="text-green-500/80">{models.length} model(s) available - pick one below.</p>}
            </div>
          )}
          {llmOk === false && (
            <div className="mb-3 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 text-xs text-amber-400">
              No local LLM detected. Start LM Studio (:1234, API server on) or Ollama (:11434), hit Re-detect - or pick a cloud vendor below.
            </div>
          )}
          {llmOk === null && (
            <div className="mb-3 flex items-center gap-2 text-xs text-zinc-500"><Loader2 size={12} className="animate-spin" /> Detecting...</div>
          )}

          <div className="space-y-3">
            <div>
              <label className="text-xs text-zinc-300 mb-1 block">Provider</label>
              <select
                value={settings.llm_provider || provider}
                onChange={(e) => {
                  const v = e.target.value;
                  const url =
                    v === "ollama" ? "http://127.0.0.1:11434/v1"
                    : v === "lm-studio" ? "http://127.0.0.1:1234/v1"
                    : v === "openai" ? ""
                    : settings.llm_url;
                  setSettings((p) => ({ ...p, llm_provider: v, llm_url: url }));
                  setProvider(v);
                  setCatalog([]);
                  loadCatalog(v, url);
                }}
                data-testid="llm-provider-select"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-amber-500/50"
              >
                <option value="">Auto (detected: {provider || "none"})</option>
                <option value="lm-studio">LM Studio - :1234/v1 (OpenAI-compatible)</option>
                <option value="ollama">Ollama - :11434/v1</option>
                <option value="custom">Custom OpenAI-compatible endpoint</option>
                <option value="openai">OpenAI (cloud, needs key)</option>
                <option value="anthropic">Anthropic (cloud, needs key)</option>
                <option value="azure">Azure OpenAI (endpoint + deployment + key)</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-zinc-300 mb-1 block flex items-center gap-1"><Globe size={12} />
                {activeProvider === "azure" ? "Azure endpoint" : activeProvider === "openai" ? "API base (optional)" : "API URL"}
              </label>
              <input value={settings.llm_url} onChange={(e) => setSettings((p) => ({ ...p, llm_url: e.target.value }))}
                placeholder={activeProvider === "azure" ? "https://YOUR.openai.azure.com" : activeProvider === "openai" ? "blank = api.openai.com" : ""}
                data-testid="llm-url-input"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-amber-500/50" />
              <p className="text-[10px] text-zinc-300 mt-1">LM Studio: 127.0.0.1:1234/v1 &bull; Ollama: 127.0.0.1:11434/v1 &bull; Azure: endpoint + deployment name as model</p>
            </div>
            {isCloud && (
              <div>
                <label className="text-xs text-zinc-300 mb-1 block flex items-center gap-1"><Key size={12} /> API key {keySaved && <span className="text-green-400">(saved)</span>}</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={keySaved ? "Saved - enter a new key to replace" : "sk-... (or set OPENAI_API_KEY / ANTHROPIC_API_KEY / AZURE_API_KEY env)"}
                  data-testid="llm-key-input"
                  autoComplete="off"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-amber-500/50" />
                <p className="text-[10px] text-zinc-500 mt-1">Stored server-side only, never sent to the browser. Empty = keep existing.</p>
              </div>
            )}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-zinc-300 flex items-center gap-1"><Key size={12} /> Model</label>
                <button
                  onClick={() => loadCatalog(settings.llm_provider || provider, settings.llm_url)}
                  disabled={catalogLoading}
                  className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 hover:text-zinc-200 disabled:opacity-50"
                  title="Refresh model list for this provider"
                >
                  <RefreshCw size={10} className={catalogLoading ? "animate-spin" : ""} />
                  {catalogLoading ? "Loading..." : "Refresh models"}
                </button>
              </div>
              {catalog.length > 0 ? (
                <select
                  value={settings.llm_model}
                  onChange={(e) => setSettings((p) => ({ ...p, llm_model: e.target.value }))}
                  data-testid="llm-model-select"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-amber-500/50"
                >
                  <option value="">Select a model... ({catalog.length} found)</option>
                  {catalog.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              ) : (
                <input value={settings.llm_model} onChange={(e) => setSettings((p) => ({ ...p, llm_model: e.target.value }))}
                  placeholder={
                    activeProvider === "openai" ? "e.g. gpt-4o-mini (save key first, then Refresh)" :
                    activeProvider === "anthropic" ? "e.g. claude-sonnet-4-0 (save key first, then Refresh)" :
                    activeProvider === "azure" ? "deployment name, e.g. gpt-4o" :
                    "e.g. llama3.2, qwen2.5:7b - or hit Re-detect"
                  }
                  data-testid="llm-model-input"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-amber-500/50" />
              )}
              {catalogNote && <p className="text-[10px] text-amber-400/90 mt-1">{catalogNote}</p>}
              <p className="text-[10px] text-zinc-500 mt-1">Used for Giskard judges and the Chat page. Saved to backend.</p>
            </div>
          </div>

          {!llmOk && (
            <div className="mt-3 p-3 rounded-lg bg-zinc-800/50 border border-zinc-800">
              <p className="text-xs text-zinc-300 font-medium mb-2">GPU Opportunity</p>
              <p className="text-[11px] text-zinc-500">High-performance GPU detected. Install LM Studio or Ollama to run Giskard scans locally without cloud API keys. <a href="https://lmstudio.ai" className="text-amber-500 hover:underline" target="_blank" rel="noreferrer">Download LM Studio</a></p>
            </div>
          )}
        </div>

        {/* MCP Scan Target */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <h2 className="text-sm font-semibold text-zinc-300 mb-3 flex items-center gap-2">
            <Target size={16} className="text-amber-500" />
            Default Scan Target
          </h2>
          <label className="text-xs text-zinc-300 mb-1 block">MCP Server URL</label>
          <input value={settings.target_mcp_url} onChange={(e) => setSettings((p) => ({ ...p, target_mcp_url: e.target.value }))}
            placeholder="http://127.0.0.1:10746/mcp"
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-amber-500/50" />
          <p className="text-[10px] text-zinc-300 mt-1">Pre-filled on the Scans page when you click a discovered server.</p>
        </div>

        {/* Save */}
        <button onClick={handleSave} disabled={saving}
          className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-700 text-black font-medium rounded-lg text-sm transition-colors">
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          {saved ? "Saved!" : "Save Settings"}
        </button>
      </div>
    </div>
  );
}
