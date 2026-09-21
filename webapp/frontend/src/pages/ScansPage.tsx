import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, Bookmark, CheckCircle, Eye, Loader2, Play, Radio, Search, Shield, ShieldAlert, Trash2, X } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { useScansStore } from "../store/scans";
import { api, type FleetServer, type SavedTarget } from "../api/client";

const PROFILE_OPTIONS = [
  { value: "prompt_injection,information_disclosure", label: "Standard (injection + disclosure)" },
  { value: "", label: "Full suite (all detectors)" },
  { value: "prompt_injection", label: "Prompt Injection + jailbreaks" },
  { value: "information_disclosure", label: "Info disclosure + data leakage" },
  { value: "harmful_content", label: "Harmful content" },
  { value: "hallucination", label: "Hallucination / faithfulness" },
  { value: "bias", label: "Bias + stereotypes" },
  { value: "boundary_testing", label: "Boundary / robustness" },
  { value: "role_play", label: "Role-play jailbreaks" },
];

const JOB_LABEL: Record<string, string> = {
  queued: "Queued...",
  "detecting-llm": "Detecting local LLM...",
  "discovering-tools": "Discovering target tools...",
  scanning: "Giskard scan running - this takes minutes...",
  cancelling: "Cancelling...",
};

export function ScansPage() {
  const { scans, loading, running, activeJob, lastResult, error, fetchScans, runScan, cancelActiveJob, removeScan } = useScansStore();
  const [searchParams] = useSearchParams();
  const [targetUrl, setTargetUrl] = useState(searchParams.get("target") || "");
  const [profiles, setProfiles] = useState("prompt_injection,information_disclosure");
  const [servers, setServers] = useState<FleetServer[]>([]);
  const [targets, setTargets] = useState<SavedTarget[]>([]);
  const [deleting, setDeleting] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    await fetchScans();
    try {
      const [t, d] = await Promise.all([api.targets.list(), api.discover()]);
      setTargets(t.targets);
      setServers(d.servers);
    } catch {}
  }, [fetchScans]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleRun = async () => {
    if (!targetUrl.trim()) return;
    try {
      await runScan(targetUrl.trim(), "", profiles);
    } catch {}
  };

  const handleSaveTarget = async () => {
    if (!targetUrl.trim()) return;
    try {
      const data = await api.targets.create(targetUrl.trim());
      setTargets(data.targets);
    } catch {}
  };

  const handleRemoveTarget = async (url: string) => {
    try {
      const data = await api.targets.remove(url);
      setTargets(data.targets);
    } catch {}
  };

  const handleRemoveScan = async (agentName: string) => {
    setDeleting(agentName);
    try {
      await removeScan(agentName);
    } catch {}
    setDeleting(null);
  };

  const issueCountOf = (r: { total_issues?: number; issue_count?: number }) =>
    r.total_issues ?? r.issue_count ?? 0;

  const asList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v ? [String(v)] : []);

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
              {PROFILE_OPTIONS.map((o) => (
                <option key={o.label} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Saved targets */}
        {targets.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {targets.map((t) => (
              <span
                key={t.url}
                className={`inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
                  targetUrl === t.url
                    ? "border-amber-500/50 bg-amber-500/10 text-amber-400"
                    : "border-zinc-800 bg-zinc-900/50 text-zinc-300"
                }`}
              >
                <button onClick={() => setTargetUrl(t.url)} className="hover:text-zinc-100" title={t.url}>
                  <Bookmark size={11} className="inline mr-1" />{t.label}
                </button>
                <button onClick={() => handleRemoveTarget(t.url)} className="text-zinc-500 hover:text-red-400" title="Forget target">
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleRun}
            disabled={running || !targetUrl.trim()}
            className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-700 disabled:text-zinc-300 text-black font-medium rounded-lg text-sm transition-colors"
          >
            {running ? <Loader2 size={16} className="animate-spin" /> : <ShieldAlert size={16} />}
            {running ? (JOB_LABEL[activeJob?.status || ""] || "Scanning...") : "Start Scan"}
          </button>
          {!running && targetUrl.trim() && (
            <button
              onClick={handleSaveTarget}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs border border-zinc-700 text-zinc-300 hover:text-zinc-200 hover:border-zinc-500"
            >
              <Bookmark size={12} /> Save target
            </button>
          )}
          {running && (
            <button
              onClick={cancelActiveJob}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs border border-red-500/40 text-red-400 hover:bg-red-500/10"
            >
              <X size={12} /> Cancel scan
            </button>
          )}
        </div>

        {error && <p className="mt-3 text-sm text-red-400 flex items-center gap-1"><AlertTriangle size={14} /> {error}</p>}

        {lastResult && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className={`mt-4 p-3 rounded-lg border text-sm ${
              issueCountOf(lastResult) > 0
                ? "border-red-500/30 bg-red-500/5 text-red-300"
                : "border-green-500/30 bg-green-500/5 text-green-300"
            }`}
          >
            <div className="flex items-center gap-2 font-medium mb-1">
              {issueCountOf(lastResult) > 0 ? <ShieldAlert size={14} /> : <CheckCircle size={14} />}
              {issueCountOf(lastResult)} issue(s) in {String(lastResult.tools_scanned ?? lastResult.tools ?? "?")} tool(s)
              {lastResult.llm_model && <span className="text-zinc-500 font-normal">- judged by {lastResult.llm_model}</span>}
            </div>
            {(() => {
              const profs = asList(lastResult.profiles);
              const tags = asList(lastResult.tags);
              return (profs.length > 0 || tags.length > 0) && (
                <p className="text-xs opacity-80">
                  Profiles: {profs.join(", ") || "full suite"}
                  {tags.length > 0 && ` (${tags.join(", ")})`}
                </p>
              );
            })()}
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
                {s.service} (:{s.port})
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Scan history */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
        <h2 className="text-sm font-semibold text-zinc-300 mb-4">Scan History - persisted across restarts</h2>
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
                  <th className="pb-2 font-medium"><span className="sr-only">Delete</span></th>
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
                      ) : issueCountOf(scan) > 0 ? (
                        <span className="flex items-center gap-1 text-red-400 text-xs"><ShieldAlert size={12} /> {issueCountOf(scan)}</span>
                      ) : (
                        <span className="flex items-center gap-1 text-green-400 text-xs"><CheckCircle size={12} /> Clean</span>
                      )}
                    </td>
                    <td className="py-2 text-xs text-zinc-500">{String(scan.tools_scanned ?? scan.tools ?? "-")}</td>
                    <td className="py-2 text-zinc-300 text-xs">{new Date(scan.timestamp).toLocaleString()}</td>
                    <td className="py-2">
                      <a href={api.reports.url(scan.report_path.split("\\").pop() || scan.report_path.split("/").pop() || "")} target="_blank" className="flex items-center gap-1 text-blue-400 hover:underline text-xs">
                        <Eye size={12} /> View
                      </a>
                    </td>
                    <td className="py-2">
                      <button
                        onClick={() => handleRemoveScan(scan.agent_name)}
                        disabled={deleting === scan.agent_name}
                        className="p-1 rounded text-zinc-500 hover:text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                        title="Delete scan + report"
                      >
                        {deleting === scan.agent_name ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                      </button>
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
