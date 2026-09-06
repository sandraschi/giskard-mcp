import { useCallback, useEffect, useState } from "react";
import {
  FlaskConical, Globe, Key, Loader2, RefreshCw, Save, Server, Shield, Target, Terminal, Wifi,
} from "lucide-react";
import { api } from "../api/client";

interface AppSettings {
  llm_url: string;
  llm_model: string;
  target_mcp_url: string;
}

export function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings>({
    llm_url: "http://127.0.0.1:1234/v1",
    llm_model: "",
    target_mcp_url: "",
  });
  const [lmStudioDetected, setLmStudioDetected] = useState<boolean | null>(null);
  const [detectedModel, setDetectedModel] = useState("");
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

  const load = useCallback(async () => {
    try {
      const [s, d] = await Promise.all([api.getSettings(), api.detectLlm()]);
      setSettings(s);
      setLmStudioDetected(d.success);
      if (d.success) setDetectedModel(d.model);
    } catch { await checkHealth(); }
  }, [checkHealth]);

  const detectNow = useCallback(async () => {
    setLmStudioDetected(null);
    try {
      const d = await api.detectLlm();
      setLmStudioDetected(d.success);
      if (d.success) {
        setSettings((p) => ({ ...p, llm_url: d.url }));
        setDetectedModel(d.model);
      } else {
        setLmStudioDetected(false);
      }
    } catch { setLmStudioDetected(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.saveSettings(settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {}
    setSaving(false);
  };

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
              Local LLM
            </h2>
            <button onClick={detectNow} className="flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-zinc-800 text-zinc-300 hover:text-zinc-200">
              <RefreshCw size={10} /> Re-detect
            </button>
          </div>

          {lmStudioDetected && (
            <div className="mb-3 p-3 rounded-lg bg-green-500/5 border border-green-500/20 text-xs text-green-400">
              <div className="flex items-center gap-1.5 font-medium mb-1"><Wifi size={12} /> LM Studio detected on port 1234</div>
              {detectedModel && <p className="text-green-500/80">Model: {detectedModel}</p>}
            </div>
          )}
          {lmStudioDetected === false && (
            <div className="mb-3 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 text-xs text-amber-400">
              No LM Studio detected on port 1234. Start LM Studio with API server enabled, or enter a custom endpoint below.
            </div>
          )}
          {lmStudioDetected === null && (
            <div className="mb-3 flex items-center gap-2 text-xs text-zinc-500"><Loader2 size={12} className="animate-spin" /> Detecting...</div>
          )}

          <div className="space-y-3">
            <div>
              <label className="text-xs text-zinc-300 mb-1 block flex items-center gap-1"><Globe size={12} /> API URL</label>
              <input value={settings.llm_url} onChange={(e) => setSettings((p) => ({ ...p, llm_url: e.target.value }))}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-amber-500/50" />
              <p className="text-[10px] text-zinc-300 mt-1">LM Studio: 127.0.0.1:1234/v1 &bull; Ollama: 127.0.0.1:11434/v1</p>
            </div>
            <div>
              <label className="text-xs text-zinc-300 mb-1 block flex items-center gap-1"><Key size={12} /> Model (optional)</label>
              <input value={settings.llm_model} onChange={(e) => setSettings((p) => ({ ...p, llm_model: e.target.value }))}
                placeholder="Auto-detected from LM Studio" className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-amber-500/50" />
            </div>
          </div>

          {!lmStudioDetected && (
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
