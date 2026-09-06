import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle, CheckCircle, ExternalLink, Eye, FileText, Maximize2,
  Minimize2, Search, ShieldAlert, X, Columns2, LayoutGrid,
} from "lucide-react";
import { api, type ReportInfo, type ScanRecord } from "../api/client";

type ViewMode = "gallery" | "detail" | "compare";

export function ReportsPage() {
  const [reports, setReports] = useState<ReportInfo[]>([]);
  const [scans, setScans] = useState<Record<string, ScanRecord>>({});
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewMode>("gallery");
  const [selected, setSelected] = useState<ReportInfo | null>(null);
  const [reportHtml, setReportHtml] = useState<string | null>(null);
  const [compareList, setCompareList] = useState<string[]>([]);
  const [compareScans, setCompareScans] = useState<ScanRecord[]>([]);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const load = useCallback(async () => {
    try {
      const [r, s] = await Promise.all([api.reports.list(), api.scans.list()]);
      setReports(r.reports);
      const scanMap: Record<string, ScanRecord> = {};
      for (const scan of s.scans) {
        const fname = scan.report_path.split("\\").pop()?.split("/").pop() || "";
        scanMap[fname] = scan;
      }
      setScans(scanMap);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const openReport = async (r: ReportInfo) => {
    setSelected(r);
    setView("detail");
    setReportHtml(null);
    try {
      const data = await api.reports.html(r.filename);
      setReportHtml(data.html);
    } catch {
      setReportHtml(null);
    }
  };

  const toggleCompare = (filename: string) => {
    setCompareList((prev) =>
      prev.includes(filename) ? prev.filter((f) => f !== filename) : [...prev, filename]
    );
  };

  const runCompare = async () => {
    if (compareList.length < 2) return;
    try {
      const data = await api.reports.compare(compareList);
      setCompareScans(data.scans);
      setView("compare");
    } catch {}
  };

  const filtered = reports.filter((r) =>
    r.filename.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <h1 className="text-2xl font-bold text-zinc-100 mb-6 flex items-center gap-2">
        <FileText className="text-amber-500" size={24} />
        Reports
      </h1>

      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter reports..."
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg pl-8 pr-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-400 focus:outline-none focus:border-amber-500/50"
          />
        </div>
        {view === "gallery" && (
          <>
            <button
              onClick={() => { setCompareList([]); }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs border border-zinc-700 text-zinc-300 hover:text-zinc-200 hover:border-zinc-600"
            >
              <Columns2 size={14} />
              {compareList.length > 0 ? `${compareList.length} selected` : "Compare"}
            </button>
            {compareList.length >= 2 && (
              <button
                onClick={runCompare}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-amber-600 hover:bg-amber-500 text-black font-medium"
              >
                <ShieldAlert size={14} /> Compare {compareList.length} reports
              </button>
            )}
          </>
        )}
        {view !== "gallery" && (
          <button
            onClick={() => { setView("gallery"); setSelected(null); setCompareScans([]); }}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs border border-zinc-700 text-zinc-300 hover:text-zinc-200"
          >
            <LayoutGrid size={14} /> Gallery
          </button>
        )}
      </div>

      {/* === GALLERY VIEW === */}
      {view === "gallery" && (
        <>
          {loading && <p className="text-zinc-300 text-sm">Loading reports...</p>}
          {!loading && filtered.length === 0 && (
            <div className="text-center py-12 text-zinc-500">
              <FileText size={40} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">No reports yet. Run a scan to generate one.</p>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {filtered.map((r, i) => {
              const scan = scans[r.filename];
              const isSelected = compareList.includes(r.filename);
              return (
                <motion.div
                  key={r.filename}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.02 }}
                >
                  <div
                    className={`rounded-xl border p-3 cursor-pointer transition-all ${
                      isSelected
                        ? "border-amber-500 bg-amber-500/10"
                        : "border-zinc-800 bg-zinc-900/50 hover:border-zinc-700"
                    }`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="min-w-0 flex-1 mr-2">
                        <p className="text-sm font-medium text-zinc-200 truncate">
                          {r.filename.replace("_vulnerability_report.html", "").replace(/_/g, " ")}
                        </p>
                        <p className="text-[10px] text-zinc-300 mt-0.5">
                          {r.modified} &middot; {(r.size / 1024).toFixed(0)} KB
                        </p>
                      </div>
                      <div className="flex gap-1 flex-shrink-0">
                        <button
                          onClick={() => openReport(r)}
                          className="p-1 rounded hover:bg-zinc-800 text-zinc-300 hover:text-zinc-200"
                          title="View report"
                        >
                          <Eye size={14} />
                        </button>
                        <a
                          href={api.reports.url(r.filename)}
                          target="_blank"
                          className="p-1 rounded hover:bg-zinc-800 text-zinc-300 hover:text-zinc-200"
                          title="Open in new tab"
                        >
                          <ExternalLink size={14} />
                        </a>
                        <button
                          onClick={() => toggleCompare(r.filename)}
                          className={`p-1 rounded transition-colors ${
                            isSelected ? "bg-amber-500/20 text-amber-400" : "hover:bg-zinc-800 text-zinc-300 hover:text-zinc-200"
                          }`}
                          title="Select for comparison"
                        >
                          <Columns2 size={14} />
                        </button>
                      </div>
                    </div>
                    {scan && (
                      <div className="flex items-center gap-2 text-xs">
                        {scan.issues_found ? (
                          <span className="flex items-center gap-1 text-red-400">
                            <ShieldAlert size={12} /> {scan.issue_count} issue(s)
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-green-400">
                            <CheckCircle size={12} /> Clean
                          </span>
                        )}
                      </div>
                    )}
                    <button
                      onClick={() => setExpanded(expanded === r.filename ? null : r.filename)}
                      className="mt-2 text-[10px] text-zinc-300 hover:text-zinc-300"
                    >
                      {expanded === r.filename ? "Hide preview" : "Quick preview"}
                    </button>
                    {expanded === r.filename && (
                      <div className="mt-2 border-t border-zinc-800 pt-2">
                        <iframe
                          src={api.reports.url(r.filename)}
                          className="w-full h-[200px] rounded-lg bg-white"
                          title={r.filename}
                        />
                      </div>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        </>
      )}

      {/* === DETAIL VIEW === */}
      {view === "detail" && selected && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
          <div className="flex items-center justify-between p-3 border-b border-zinc-800">
            <div>
              <p className="text-sm font-medium text-zinc-200">
                {selected.filename.replace("_vulnerability_report.html", "").replace(/_/g, " ")}
              </p>
              <p className="text-[10px] text-zinc-500">
                {selected.modified} &middot; {(selected.size / 1024).toFixed(0)} KB
              </p>
            </div>
            <div className="flex gap-2">
              <a
                href={api.reports.url(selected.filename)}
                target="_blank"
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs border border-zinc-700 text-zinc-300 hover:text-zinc-200"
              >
                <ExternalLink size={12} /> Open
              </a>
              <button
                onClick={() => { setView("gallery"); setSelected(null); }}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs border border-zinc-700 text-zinc-300 hover:text-zinc-200"
              >
                <X size={12} /> Close
              </button>
            </div>
          </div>
          {reportHtml ? (
            <iframe
              srcDoc={reportHtml}
              className="w-full h-[calc(100vh-16rem)] bg-white"
              title={selected.filename}
            />
          ) : (
            <iframe
              src={api.reports.url(selected.filename)}
              className="w-full h-[calc(100vh-16rem)] bg-white"
              title={selected.filename}
            />
          )}
        </div>
      )}

      {/* === COMPARE VIEW === */}
      {view === "compare" && (
        <div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            {compareScans.map((s) => (
              <div key={s.agent_name} className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
                <h3 className="text-sm font-semibold text-zinc-200 mb-3">{s.agent_name}</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Issues Found</span>
                    <span className={s.issues_found ? "text-red-400" : "text-green-400"}>
                      {s.issues_found ? "Yes" : "No"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Issue Count</span>
                    <span className="text-zinc-200">{s.issue_count}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Timestamp</span>
                    <span className="text-zinc-300 text-xs">{new Date(s.timestamp).toLocaleString()}</span>
                  </div>
                  <a
                    href={api.reports.url(s.report_path.split("\\").pop() || s.report_path.split("/").pop() || "")}
                    target="_blank"
                    className="flex items-center gap-1 text-amber-400 hover:underline text-xs mt-2"
                  >
                    <Eye size={12} /> View full report
                  </a>
                </div>
              </div>
            ))}
          </div>

          {/* Side-by-side iframes */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {compareScans.map((s) => {
              const fname = s.report_path.split("\\").pop()?.split("/").pop() || "";
              return (
                <div key={`iframe-${s.agent_name}`} className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
                  <p className="text-[10px] text-zinc-300 px-3 py-1.5 border-b border-zinc-800">{s.agent_name}</p>
                  <iframe
                    src={api.reports.url(fname)}
                    className="w-full h-[500px] bg-white"
                    title={s.agent_name}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
