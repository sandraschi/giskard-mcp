import { AlertTriangle, ArrowLeft, CheckCircle, Eye, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { type ReportInfo, type ScanRecord, api } from "../api/client";

export function ScanDetail() {
  const { agentName } = useParams();
  const [scan, setScan] = useState<ScanRecord | null>(null);
  const [reportUrl, setReportUrl] = useState<string>("");
  const [loading, setLoading] = useState(true);

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

  if (loading) return <div className="text-zinc-300 text-sm">Loading...</div>;
  if (!scan) return <div className="text-red-400 text-sm">Scan not found for '{agentName}'</div>;

  return (
    <div>
      <Link to="/scans" className="inline-flex items-center gap-1 text-sm text-zinc-300 hover:text-zinc-300 mb-4">
        <ArrowLeft size={14} /> Back to Scans
      </Link>

      <h1 className="text-2xl font-bold text-zinc-100 mb-6">{scan.agent_name}</h1>

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
