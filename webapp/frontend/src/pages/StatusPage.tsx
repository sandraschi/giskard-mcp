import { Activity, Clock, Cpu, FlaskConical, HardDrive, Server, Shield } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { type DiagnosticsInfo, api } from "../api/client";
import { useBackendStore } from "../store/backend";
import { type LogEntry, useLogsStore } from "../store/logs";

export function StatusPage() {
  const { connected } = useBackendStore();
  const [diag, setDiag] = useState<DiagnosticsInfo | null>(null);
  const { logs } = useLogsStore();

  const load = useCallback(async () => {
    try {
      const d = await api.diagnostics();
      setDiag(d);
    } catch {}
  }, []);

  useEffect(() => {
    load();
    const i = setInterval(load, 15000);
    return () => clearInterval(i);
  }, [load]);

  const stats = [
    { label: "Service", value: diag?.service || "...", icon: Server },
    { label: "Version", value: diag?.version || "...", icon: Shield },
    {
      label: "Uptime",
      value: diag ? `${Math.floor(diag.uptime_seconds / 60)}m ${diag.uptime_seconds % 60}s` : "...",
      icon: Clock,
    },
    { label: "Port", value: diag?.port || "...", icon: Cpu },
    { label: "Scans Run", value: diag?.total_scans ?? "...", icon: Activity },
    {
      label: "Reports",
      value: diag?.reports_available ?? "...",
      icon: HardDrive,
    },
    {
      label: "LLM",
      value: diag?.lm_studio_detected ? "Detected" : "Offline",
      icon: FlaskConical,
    },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold text-zinc-100 mb-6 flex items-center gap-2">
        <Activity className="text-amber-500" size={24} />
        Status
      </h1>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-6">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
            <div className="flex items-center gap-2 mb-1">
              <s.icon size={14} className="text-amber-500" />
              <p className="text-[10px] text-zinc-300 uppercase tracking-wider">{s.label}</p>
            </div>
            <p className="text-sm font-medium text-zinc-200">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Live logs */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-zinc-300 flex items-center gap-2">
            <Activity size={14} className="text-amber-500" />
            Log Stream
          </h2>
          <span className={`w-2 h-2 rounded-full ${connected ? "bg-green-500" : "bg-red-500"}`} />
        </div>
        <div className="bg-zinc-950 rounded-lg p-3 font-mono text-[11px] max-h-[400px] overflow-y-auto space-y-0.5">
          {logs.length === 0 && <span className="text-zinc-500">Waiting for log events...</span>}
          {logs.map((log, i) => (
            <div
              key={i}
              className={`${
                log.level === "error" ? "text-red-400" : log.level === "warn" ? "text-amber-400" : "text-zinc-500"
              }`}
            >
              <span className="text-zinc-700">{log.timestamp}</span> {log.message}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
