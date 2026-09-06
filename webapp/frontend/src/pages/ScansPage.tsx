import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, CheckCircle, Eye, Loader2, Play, Radio, Search, Shield, ShieldAlert } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { useScansStore } from "../store/scans";
import { api, type FleetServer } from "../api/client";

export function ScansPage() {
  const { scans, loading, running, lastResult, error, fetchScans, runScan } = useScansStore();
  const [searchParams] = useSearchParams();
  const [targetUrl, setTargetUrl] = useState(searchParams.get("target") || "");
  const [profiles, setProfiles] = useState("prompt_injection,information_disclosure");
  const [reports, setReports] = useState<{ filename: string; size: number }[]>([]);
  const [servers, setServers] = useState<FleetServer[]>([]);

  const refresh = useCallback(async () => {
    await fetchScans();
    try {
      const [r, d] = await Promise.all([api.reports.list(), api.discover()]);
      setReports(r.reports);
      setServers(d.servers);
    } catch {}
  }, [fetchScans]);

  useEffect(() => { refresh(); }, []);

  const handleRun = async () => {
    if (!targetUrl.trim()) return;
    try {
      await runScan(targetUrl.trim(), profiles);
    } catch {}
  };

  const currentScan = scans[0];

  return (
    <div>
      <h1 className="text-2xl font-bold text-zinc-100 mb-6 flex items-center gap-2">
        <Shield className="text-amber-500" size={24} />
        Fleet Scans
      </h1>

      {/* Run scan form */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 mb-6"
      >
        <h2 className="text-sm font-semibold text-zinc-300 mb-4 flex items-center gap-2">
          <Play size={16} className="text-amber-500" />
          Scan MCP Server
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
          <input
            value={targetUrl}
            onChange={(e) => setTargetUrl(e.target.value)}
            placeholder="MCP URL (e.g. http://127.0.0.1:10702/mcp)"
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-400 focus:outline-none focus:border-amber-500/50 md:col-span-2"
          />
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <select
              value={profiles}
              onChange={(e) => setProfiles(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg pl-8 pr-3 py-2 text-sm text-zinc-200 appearance-none cursor-pointer focus:outline-none focus:border-amber-500/50"
            >
              <option value="prompt_injection,information_disclosure">Standard (injection + disclosure)</option>
              <option value="prompt_injection,information_disclosure,boundary_testing,role_play">Full (all profiles)</option>
              <option value="prompt_injection">Prompt Injection only</option>
              <option value="boundary_testing">Boundary Testing only</option>
            </select>
          </div>
        </div>
        <button
          onClick={handleRun}
          disabled={running || !targetUrl.trim()}
          className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-700 disabled:text-zinc-300 text-black font-medium rounded-lg text-sm transition-colors"
        >
          {running ? <Loader2 size={16} className="animate-spin" /> : <ShieldAlert size={16} />}
          {running ? "Scanning..." : "Start Scan"}
        </button>

        {error && <p className="mt-3 text-sm text-red-400 flex items-center gap-1"><AlertTriangle size={14} /> {error}</p>}

        {lastResult && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className={`mt-4 p-3 rounded-lg border text-sm ${
              lastResult.success
                ? lastResult.total_issues > 0
                  ? "border-red-500/30 bg-red-500/5 text-red-300"
                  : "border-green-500/30 bg-green-500/5 text-green-300"
                : "border-red-500/30 bg-red-500/5 text-red-300"
            }`}
          >
            <div className="flex items-center gap-2 font-medium mb-1">
              {lastResult.total_issues > 0 ? <ShieldAlert size={14} /> : <CheckCircle size={14} />}
              {lastResult.success
                ? `${lastResult.total_issues} issue(s) in ${lastResult.tools_scanned?.length || 0} tool(s)`
                : `Scan failed: ${lastResult.error}`}
            </div>
          </motion.div>
        )}
      </motion.div>

      {/* Discovered servers quick-select */}
      {servers.length > 0 && (
        <div className="mb-6">
          <h3 className="text-xs font-semibold text-zinc-300 mb-2 flex items-center gap-1">
            <Radio size={12} /> Discovered MCP Servers
          </h3>
          <div className="flex flex-wrap gap-2">
            {servers.map((s) => (
              <button
                key={s.port}
                onClick={() => setTargetUrl(`http://127.0.0.1:${s.port}/mcp`)}
                className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
                  targetUrl.includes(String(s.port))
                    ? "border-amber-500/50 bg-amber-500/10 text-amber-400"
                    : "border-zinc-800 bg-zinc-900/50 text-zinc-300 hover:text-zinc-200 hover:border-zinc-700"
                }`}
              >
                {s.service} (:{(s as any).port})
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Scan history */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
        <h2 className="text-sm font-semibold text-zinc-300 mb-4">Scan History</h2>
        {loading && <div className="flex items-center gap-2 text-zinc-300 text-sm"><Loader2 size={14} className="animate-spin" /> Loading...</div>}
        {!loading && scans.length === 0 && <p className="text-sm text-zinc-500">No scans run yet.</p>}
        {scans.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-zinc-300 text-xs border-b border-zinc-800">
                  <th className="pb-2 font-medium">Target</th>
                  <th className="pb-2 font-medium">Issues</th>
                  <th className="pb-2 font-medium">Tools</th>
                  <th className="pb-2 font-medium">Time</th>
                  <th className="pb-2 font-medium">Report</th>
                </tr>
              </thead>
              <tbody>
                {scans.map((scan, i) => (
                  <tr key={i} className="border-b border-zinc-800/50 text-zinc-300 hover:bg-zinc-800/30">
                    <td className="py-2">
                      <Link to={`/scans/${encodeURIComponent(scan.agent_name)}`} className="text-amber-400 hover:underline text-xs">
                        {scan.target || scan.agent_name}
                      </Link>
                    </td>
                    <td className="py-2">
                      {scan.error ? (
                        <span className="flex items-center gap-1 text-red-400 text-xs"><AlertTriangle size={12} /> Error</span>
                      ) : (scan.total_issues || 0) > 0 ? (
                        <span className="flex items-center gap-1 text-red-400 text-xs"><ShieldAlert size={12} /> {scan.total_issues}</span>
                      ) : (
                        <span className="flex items-center gap-1 text-green-400 text-xs"><CheckCircle size={12} /> Clean</span>
                      )}
                    </td>
                    <td className="py-2 text-xs text-zinc-500">{scan.tools_scanned || "-"}</td>
                    <td className="py-2 text-zinc-300 text-xs">{new Date(scan.timestamp).toLocaleString()}</td>
                    <td className="py-2">
                      <a href={api.reports.url(scan.report_path.split("\\").pop() || scan.report_path.split("/").pop() || "")} target="_blank" className="flex items-center gap-1 text-blue-400 hover:underline text-xs">
                        <Eye size={12} /> View
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
