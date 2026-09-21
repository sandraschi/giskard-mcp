import { AlertTriangle, ArrowLeft, CheckCircle, Eye, Loader2, ShieldAlert, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { type ScanRecord, api } from "../api/client";

export function ScanDetail() {
  const { agentName } = useParams();
  const navigate = useNavigate();
  const [scan, setScan] = useState<ScanRecord | null>(null);
  const [reportUrl, setReportUrl] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    if (!agentName) return;
    setLoading(true);
    try {
      const data = await api.scans.detail(agentName);
      setScan(data.scan);
      const reports = await api.reports.list();
      const match = reports.reports.find((r) => data.scan.report_path.includes(r.filename.replace(".html", "")));
      if (match) setReportUrl(api.reports.url(match.filename));
    } catch {}
    setLoading(false);
  }, [agentName]);

  useEffect(() => {
    load();
  }, [load]);

  const handleDelete = async () => {
    if (!agentName) return;
    if (!window.confirm(`Delete scan "${agentName}" and its report? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await api.scans.remove(agentName);
      navigate("/scans");
    } catch {}
    setDeleting(false);
  };

  if (loading) return <div className="text-zinc-300 text-sm">Loading...</div>;
  if (!scan) return <div className="text-red-400 text-sm">Scan not found for '{agentName}'</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <Link to="/scans" className="inline-flex items-center gap-1 text-sm text-zinc-300 hover:text-zinc-300">
          <ArrowLeft size={14} /> Back to Scans
        </Link>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-red-500/40 text-red-400 hover:bg-red-500/10 disabled:opacity-50"
        >
          {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
          {deleting ? "Deleting..." : "Delete scan"}
        </button>
      </div>

      <h1 className="text-2xl font-bold text-zinc-100 mb-1">{scan.agent_name}</h1>
      <p className="text-xs text-zinc-500 mb-6">
        {scan.target}
        {scan.llm_model && ` - judged by ${scan.llm_model}`}
        {Array.isArray(scan.profiles) && scan.profiles.length > 0 && ` - ${(scan.profiles as string[]).join(", ")}`}
      </p>

      {/* Issues raised by Giskard detectors */}
      {Array.isArray(scan.issues) && (scan.issues as { group?: string; description?: string; severity?: string }[]).length > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 mb-6">
          <p className="text-xs text-zinc-300 mb-3 font-medium">Detected issues ({(scan.issues as unknown[]).length})</p>
          <div className="space-y-2">
            {(scan.issues as { group?: string; description?: string; severity?: string }[]).map((issue, i) => (
              <div key={i} className="flex items-start gap-2 text-sm border-b border-zinc-800/50 pb-2 last:border-0 last:pb-0">
                <AlertTriangle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-zinc-200 text-xs font-medium">{issue.group || "unknown"}{issue.severity ? ` - ${issue.severity}` : ""}</p>
                  {issue.description && <p className="text-zinc-500 text-xs truncate">{issue.description}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-xs text-zinc-300 mb-1">Issues Found</p>
          <p
            className={`text-lg font-bold flex items-center gap-2 ${scan.issues_found ? "text-red-400" : "text-green-400"}`}
          >
            {scan.issues_found ? <ShieldAlert size={18} /> : <CheckCircle size={18} />}
            {scan.issues_found ? "Yes" : "No"}
          </p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-xs text-zinc-300 mb-1">Issue Count</p>
          <p className="text-lg font-bold text-zinc-200">{scan.issue_count}</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-xs text-zinc-300 mb-1">Timestamp</p>
          <p className="text-sm text-zinc-300">{new Date(scan.timestamp).toLocaleString()}</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-xs text-zinc-300 mb-1">Report</p>
          {reportUrl ? (
            <a
              href={reportUrl}
              target="_blank"
              className="flex items-center gap-1 text-amber-400 hover:underline text-sm"
              rel="noreferrer"
            >
              <Eye size={14} /> View Full Report
            </a>
          ) : (
            <p className="text-sm text-zinc-500">{scan.report_path}</p>
          )}
        </div>
      </div>

      {reportUrl && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden h-[600px]">
          <iframe src={reportUrl} className="w-full h-full" title="Scan report" />
        </div>
      )}
    </div>
  );
}
