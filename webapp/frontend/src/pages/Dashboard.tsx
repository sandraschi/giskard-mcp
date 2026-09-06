import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Activity, Clock, FlaskConical, Radio, Search, Server, Shield, Target, Wifi } from "lucide-react";
import { Link } from "react-router-dom";
import { useBackendStore } from "../store/backend";
import { api, type FleetServer } from "../api/client";

export function Dashboard() {
  const { connected, checkHealth } = useBackendStore();
  const [reportsCount, setReportsCount] = useState(0);
  const [uptime, setUptime] = useState(0);
  const [lmStudio, setLmStudio] = useState(false);
  const [servers, setServers] = useState<FleetServer[]>([]);
  const [scanCount, setScanCount] = useState(0);
  const [scanning, setScanning] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [status, diag, scans] = await Promise.all([
        api.status(),
        api.diagnostics(),
        api.scans.list(),
      ]);
      setReportsCount(diag.reports_available);
      setUptime(diag.uptime_seconds);
      setLmStudio(diag.lm_studio_detected);
      setScanCount(scans.total);
    } catch {}
  }, []);

  const discover = useCallback(async () => {
    setScanning(true);
    try {
      const data = await api.discover();
      setServers(data.servers);
    } catch {}
    setScanning(false);
  }, []);

  useEffect(() => { refresh(); const i = setInterval(refresh, 10000); return () => clearInterval(i); }, [refresh]);

  const cards = [
    {
      label: "Backend", value: connected === null ? "..." : connected ? "Online" : "Offline",
      icon: Server, color: connected ? "text-green-400" : "text-red-400", bg: connected ? "bg-green-500/10" : "bg-red-500/10",
    },
    { label: "Scans Run", value: scanCount, icon: Shield, color: "text-amber-400", bg: "bg-amber-500/10" },
    { label: "Reports", value: reportsCount, icon: Activity, color: "text-blue-400", bg: "bg-blue-500/10" },
    { label: "Uptime", value: `${Math.floor(uptime / 60)}m`, icon: Clock, color: "text-purple-400", bg: "bg-purple-500/10" },
    { label: "LM Studio", value: lmStudio ? "Detected" : "Offline", icon: Wifi, color: lmStudio ? "text-emerald-400" : "text-zinc-500", bg: lmStudio ? "bg-emerald-500/10" : "bg-zinc-500/10" },
    { label: "Fleet Found", value: servers.length, icon: Radio, color: "text-cyan-400", bg: "bg-cyan-500/10" },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold text-zinc-100 mb-6 flex items-center gap-2">
        <Shield className="text-amber-500" size={24} />
        Dashboard
      </h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {cards.map((card, i) => (
          <motion.div
            key={card.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className={`rounded-xl border border-zinc-800 p-4 ${card.bg} backdrop-blur-sm`}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-zinc-300 mb-1">{card.label}</p>
                <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
              </div>
              <card.icon className={`w-8 h-8 ${card.color} opacity-60`} />
            </div>
          </motion.div>
        ))}
      </div>

      {/* Fleet discovery */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
              <Radio size={16} className="text-amber-500" />
              Fleet Discovery
            </h3>
            <button
              onClick={discover}
              disabled={scanning}
              className="text-xs flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 hover:text-zinc-200 disabled:opacity-50"
            >
              {scanning ? "Scanning..." : "Scan"}
            </button>
          </div>
          {servers.length === 0 ? (
            <p className="text-xs text-zinc-500">Click "Scan" to discover MCP servers on ports 10700-11500.</p>
          ) : (
            <div className="space-y-1 max-h-[200px] overflow-y-auto">
              {servers.map((s) => (
                <div key={s.port} className="flex items-center justify-between text-xs py-1.5 px-2 rounded hover:bg-zinc-800/50">
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                    <span className="text-zinc-300">{s.service}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-zinc-500">:{s.port}</span>
                    <Link to={`/scans?target=http://127.0.0.1:${s.port}/mcp`} className="text-amber-500 hover:underline">Scan</Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <Link to="/scans" className="block">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 h-full hover:border-amber-500/30 transition-colors">
            <div className="flex items-center gap-3 mb-2">
              <Shield className="text-amber-500" size={20} />
              <h3 className="font-semibold text-zinc-200">Run Fleet Scan</h3>
            </div>
            <p className="text-sm text-zinc-500">Scan any MCP server in the fleet for prompt injection, information disclosure, and boundary vulnerabilities.</p>
          </div>
        </Link>
      </div>

      {!lmStudio && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4"
        >
          <p className="text-sm text-amber-400">
            <strong>LM Studio not detected.</strong> Start LM Studio on port 1234 with API server enabled to generate adversarial attacks and evaluate responses.{" "}
            <a href="https://lmstudio.ai" className="underline" target="_blank" rel="noreferrer">Download LM Studio</a>
          </p>
        </motion.div>
      )}
    </div>
  );
}
