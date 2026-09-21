import { useCallback, useEffect, useState } from "react";
import {
  Check, Cpu, FlaskConical, Key, Loader2, RefreshCw, Save, Server, Target, Trash2, Wifi,
} from "lucide-react";
import { api } from "../api/client";
import { deleteLlmKey } from "../lib/provider";
import { useLlmStore } from "../store/llm";

export function SettingsPage() {
  const llm = useLlmStore();
  const [targetUrl, setTargetUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [keyBusy, setKeyBusy] = useState("");
  const [cardNote, setCardNote] = useState<Record<string, string>>({});
  const [restarting, setRestarting] = useState(false);
  const [backendOk, setBackendOk] = useState<boolean | null>(null);

  const checkHealth = useCallback(async () => {
    try {
      const h = await api.health();
      setBackendOk(h.ok);
    } catch { setBackendOk(false); }
  }, []);

  useEffect(() => {
    checkHealth();
    llm.probeAll();
    api.getSettings().then((s) => setTargetUrl(s.target_mcp_url)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const handleSave = async () => {
    setSaving(true);
    setSaveError("");
    try {
      const ok = await llm.persistSelection(apiKey || undefined);
      if (apiKey) setApiKey("");
      if (targetUrl !== undefined) {
        await api.saveSettings({
          llm_url: "",
          llm_model: llm.selectedModel,
          llm_provider: llm.selectedProvider,
          target_mcp_url: targetUrl,
        }).catch(() => null);
      }
      if (ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } else {
        setSaveError("Save failed - is the backend reachable?");
      }
    } catch {
      setSaveError("Save failed - is the backend reachable?");
    }
    setSaving(false);
  };

  const handleForgetKey = async (id: string) => {
    setKeyBusy(id);
    try {
      await deleteLlmKey(id);
      await llm.probeAll();
    } catch {}
    setKeyBusy("");
  };

  const handleTestCard = async (id: string) => {
    setCardNote((p) => ({ ...p, [id]: "Probing..." }));
    try {
      const { fetchModels } = await import("../lib/provider");
      const data = await fetchModels(id);
      setCardNote((p) => ({
        ...p,
        [id]: data.models.length > 0
          ? `${data.models.length} model(s), source: ${data.source}`
          : data.note || data.error || "No models found",
      }));
      await llm.probeAll();
    } catch (e: any) {
      setCardNote((p) => ({ ...p, [id]: e.message }));
    }
  };

  const selected = llm.providers.find((p) => p.id === llm.selectedProvider);
  const anyUsable = llm.providers.some(
    (p) => llm.providerStatus[p.id] === "detected" && (p.kind === "local" || p.configured),
  );

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

        {/* LLM Providers */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-sm font-semibold text-zinc-300 flex items-center gap-2">
              <FlaskConical size={16} className="text-amber-500" />
              LLM Providers - judges + chat
            </h2>
            <button onClick={() => llm.probeAll()} disabled={llm.probing} data-testid="llm-redetect" className="flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-zinc-800 text-zinc-300 hover:text-zinc-200 disabled:opacity-50">
              <RefreshCw size={10} className={llm.probing ? "animate-spin" : ""} /> Re-detect
            </button>
          </div>
          <p className="text-[11px] text-zinc-500 mb-4">Local engines are free. Cloud vendors need a key (stored server-side only). Selection saves to this browser + the backend.</p>

          {llm.error && <p className="mb-3 text-xs text-red-400">{llm.error} — is the backend running the new code?</p>}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
            {llm.providers.map((p) => {
              const st = llm.providerStatus[p.id] || "probing";
              const active = llm.selectedProvider === p.id;
              return (
                <div
                  key={p.id}
                  data-testid={`llm-provider-card-${p.id}`}
                  onClick={() => llm.selectProvider(p.id)}
                  className={`rounded-lg border p-3 cursor-pointer transition-colors ${
                    active ? "border-amber-500/60 bg-amber-500/5" : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-600"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-zinc-200 flex items-center gap-1.5">
                      {active && <Check size={12} className="text-amber-400" />}
                      {p.label}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${p.kind === "local" ? "bg-green-500/10 text-green-400" : "bg-blue-500/10 text-blue-400"}`}>
                      {p.kind === "local" ? "Local / free" : "Cloud / paid"}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                    <span className={`w-1.5 h-1.5 rounded-full ${st === "probing" ? "bg-zinc-500" : st === "detected" ? "bg-green-500" : "bg-red-500"}`} />
                    {st === "probing" ? "Probing..." : st === "detected"
                      ? (p.kind === "local" ? `Detected${p.models?.length ? ` - ${p.models.length} models` : ""}` : p.configured ? "Key configured" : "Needs key")
                      : p.kind === "local" ? "Not found" : p.configured ? "Key saved" : "No key"}
                  </div>
                  {p.kind === "cloud" && active && (
                    <div className="mt-2 space-y-1.5" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="password"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder={p.configured ? `Saved (${p.key_env}) - enter new to replace` : `Paste key or set ${p.key_env}`}
                        data-testid={`llm-key-${p.id}`}
                        autoComplete="off"
                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-amber-500/50"
                      />
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => handleTestCard(p.id)}
                          data-testid={`llm-test-${p.id}`}
                          className="text-[10px] px-2 py-1 rounded bg-zinc-800 text-zinc-300 hover:text-zinc-200"
                        >
                          Test
                        </button>
                        {p.configured && (
                          <button
                            onClick={() => handleForgetKey(p.id)}
                            disabled={keyBusy === p.id}
                            className="flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-zinc-800 text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                          >
                            <Trash2 size={10} /> {keyBusy === p.id ? "Forgetting..." : "Forget key"}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                  {p.kind === "local" && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleTestCard(p.id); }}
                      data-testid={`llm-test-${p.id}`}
                      className="mt-1.5 text-[10px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 hover:text-zinc-200"
                    >
                      Test
                    </button>
                  )}
                  {cardNote[p.id] && <p className="mt-1.5 text-[10px] text-zinc-400">{cardNote[p.id]}</p>}
                </div>
              );
            })}
          </div>

          {!llm.probing && !anyUsable && (
            <div className="mb-3 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 text-xs text-amber-400">
              No usable LLM. Start LM Studio (:1234) or Ollama (:11434) — or save a cloud key above.
            </div>
          )}

          {/* Active pair */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-zinc-300 mb-1 block">Provider</label>
              <select
                value={llm.selectedProvider}
                onChange={(e) => llm.selectProvider(e.target.value)}
                data-testid="llm-provider-select"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-amber-500/50"
              >
                <option value="">{llm.probing ? "Probing..." : "No local LLM detected"}</option>
                {llm.providers
                  .filter((p) => llm.providerStatus[p.id] === "detected" || p.id === llm.selectedProvider)
                  .map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
              </select>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-zinc-300 flex items-center gap-1"><Key size={12} /> Model</label>
                <button
                  onClick={() => llm.refreshModels()}
                  disabled={llm.modelsLoading || !llm.selectedProvider}
                  className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 hover:text-zinc-200 disabled:opacity-50"
                >
                  <RefreshCw size={10} className={llm.modelsLoading ? "animate-spin" : ""} />
                  {llm.modelsLoading ? "Loading..." : "Refresh"}
                </button>
              </div>
              {llm.models.length > 0 ? (
                <select
                  value={llm.selectedModel}
                  onChange={(e) => llm.selectModel(e.target.value)}
                  data-testid="llm-model-select"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-amber-500/50"
                >
                  <option value="">Select a model... ({llm.models.length} found, {llm.modelsSource})</option>
                  {llm.models.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              ) : (
                <input
                  value={llm.selectedModel}
                  onChange={(e) => llm.selectModel(e.target.value)}
                  placeholder={selected?.id === "azure" ? "deployment name, e.g. gpt-4o" : "Save, then Refresh - or type a name"}
                  data-testid="llm-model-input"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-amber-500/50"
                />
              )}
              {llm.modelsNote && <p className="text-[10px] text-amber-400/90 mt-1">{llm.modelsNote}</p>}
            </div>
          </div>

          {llm.gpus.length > 1 && (
            <div className="mt-3">
              <label className="text-xs text-zinc-300 mb-1 flex items-center gap-1"><Cpu size={12} /> GPU target</label>
              <select
                value={llm.gpuIndex}
                onChange={(e) => llm.selectGpu(Number(e.target.value))}
                data-testid="llm-gpu-select"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-amber-500/50"
              >
                {llm.gpus.map((g) => (
                  <option key={g.index} value={g.index}>
                    [{g.index}] {g.name} - {g.free_mb} MB free
                  </option>
                ))}
              </select>
            </div>
          )}
          {llm.gpus.length === 1 && (
            <p className="mt-2 text-[10px] text-zinc-500 flex items-center gap-1">
              <Wifi size={10} /> GPU: {llm.gpus[0].name} ({llm.gpus[0].free_mb} MB free)
            </p>
          )}
        </div>

        {/* MCP Scan Target */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <h2 className="text-sm font-semibold text-zinc-300 mb-3 flex items-center gap-2">
            <Target size={16} className="text-amber-500" />
            Default Scan Target
          </h2>
          <label className="text-xs text-zinc-300 mb-1 block">MCP Server URL</label>
          <input value={targetUrl} onChange={(e) => setTargetUrl(e.target.value)}
            placeholder="http://127.0.0.1:10746/mcp"
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-amber-500/50" />
        </div>

        {/* Save */}
        <div>
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-700 text-black font-medium rounded-lg text-sm transition-colors">
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {saved ? "Saved!" : "Save Settings"}
          </button>
          {saveError && <p className="mt-2 text-xs text-red-400">{saveError}</p>}
        </div>
      </div>
    </div>
  );
}
