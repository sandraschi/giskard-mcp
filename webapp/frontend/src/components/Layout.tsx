import { AnimatePresence, motion } from "framer-motion";
import {
  Activity, Bug, ChevronLeft, ChevronRight, Code2, Cpu, FileText, FlaskConical,
  Globe, HelpCircle, LayoutDashboard, MessageSquare, RefreshCw, Settings, Shield, Terminal, X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useBackendStore } from "../store/backend";
import { useLogsStore } from "../store/logs";

const NAV = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard },
  { path: "/scans", label: "Scans", icon: Shield },
  { path: "/reports", label: "Reports", icon: FileText },
  { path: "/tools", label: "Tools", icon: Code2 },
  { path: "/apps", label: "Apps Hub", icon: Globe },
  { path: "/chat", label: "Chat", icon: MessageSquare },
  { path: "/skills", label: "Skills", icon: FlaskConical },
  { path: "/status", label: "Status", icon: Activity },
  { path: "/settings", label: "Settings", icon: Settings },
];

function useZoom() {
  const ZOOM_LEVELS = [0.8, 1.0, 1.25, 1.5, 2.0, 3.0];
  const [zoomIndex, setZoomIndex] = useState(() => {
    try {
      const saved = localStorage.getItem("tauri-zoom");
      return saved ? ZOOM_LEVELS.indexOf(Number.parseFloat(saved)) : 1;
    } catch { return 1; }
  });
  const applyZoom = useCallback(async (level: number) => {
    localStorage.setItem("tauri-zoom", String(level));
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const win = await getCurrentWindow();
      if (typeof (win as any).setZoom === "function") {
        await (win as any).setZoom(level);
      }
    } catch { /* not in Tauri */ }
  }, []);
  useEffect(() => {
    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoomIndex((prev) => {
        const next = e.deltaY < 0 ? Math.min(prev + 1, ZOOM_LEVELS.length - 1) : Math.max(prev - 1, 0);
        if (next !== prev) applyZoom(ZOOM_LEVELS[next]);
        return next;
      });
    };
    window.addEventListener("wheel", handler, { passive: false });
    const saved = localStorage.getItem("tauri-zoom");
    if (saved) applyZoom(Number.parseFloat(saved));
    return () => window.removeEventListener("wheel", handler);
  }, [applyZoom]);
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const location = useLocation();
  const { connected, checkHealth } = useBackendStore();
  const { visible: logVisible, setVisible: setLogVisible, logs, clear: clearLogs } = useLogsStore();
  const logBottomRef = useRef<HTMLDivElement>(null);

  useZoom();

  // Scroll log panel to bottom
  useEffect(() => { logBottomRef.current?.scrollIntoView(); }, [logs]);

  // HTTP polling for health
  useEffect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, 15000);
    return () => clearInterval(interval);
  }, [checkHealth]);

  // Tauri backend-status event listener
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen<string>("backend-status", (event) => {
          if (event.payload === "ready") { checkHealth(); }
          else if (typeof event.payload === "string" && event.payload.startsWith("error:")) {
            useBackendStore.setState({ connected: false });
          }
        });
      } catch { /* not in Tauri */ }
    })();
    return () => { if (unlisten) unlisten(); };
  }, [checkHealth]);

  const restartBackend = useCallback(async () => {
    setRestarting(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("start_backend");
    } catch { /* not in Tauri */ }
    setTimeout(() => { checkHealth(); setRestarting(false); }, 5000);
  }, [checkHealth]);

  return (
    <div className="flex h-screen overflow-hidden bg-zinc-950 text-zinc-200">
      {/* Sidebar */}
      <motion.aside
        animate={{ width: collapsed ? 64 : 240 }}
        className="flex flex-col border-r border-zinc-800 bg-zinc-900/50 backdrop-blur-xl flex-shrink-0 overflow-hidden"
      >
        <div className="flex items-center justify-between p-3 border-b border-zinc-800">
          {!collapsed && (
            <div className="flex items-center gap-2">
              <Bug className="w-5 h-5 text-amber-500" />
              <span className="font-semibold text-sm text-zinc-100">Giskard MCP</span>
            </div>
          )}
          {collapsed && <Bug className="w-5 h-5 text-amber-500 mx-auto" />}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100"
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </div>

        <nav className="flex-1 py-2 space-y-1 overflow-y-auto">
          {NAV.map(({ path, label, icon: Icon }) => {
            const active = location.pathname === path;
            return (
              <Link
                key={path}
                to={path}
                className={`flex items-center gap-3 px-3 py-2 mx-2 rounded-lg text-sm transition-colors ${
                  active
                    ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                    : "text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800"
                }`}
                title={collapsed ? label : undefined}
              >
                <Icon size={18} className="flex-shrink-0" />
                {!collapsed && <span>{label}</span>}
              </Link>
            );
          })}
        </nav>

        {/* Connection status + restart */}
        <div className="p-3 border-t border-zinc-800 space-y-2">
          <button
            onClick={restartBackend}
            disabled={restarting}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-300 hover:text-zinc-100 transition-colors"
          >
            <RefreshCw size={12} className={restarting ? "animate-spin" : ""} />
            {restarting ? "Restarting..." : "Restart Backend"}
          </button>
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${
                connected === null ? "bg-zinc-500" : connected ? "bg-green-500" : "bg-red-500"
              }`}
            />
            {!collapsed && (
              <span className="text-xs text-zinc-400">
                {connected === null ? "Connecting..." : connected ? "Connected" : "Offline"}
              </span>
            )}
          </div>
        </div>
      </motion.aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Topbar */}
        <header className="flex items-center justify-between h-12 px-4 border-b border-zinc-800 bg-zinc-900/30 backdrop-blur-xl flex-shrink-0">
          <span className="text-sm font-medium text-zinc-200">
            {NAV.find((n) => n.path === location.pathname)?.label || "Giskard"}
          </span>
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${
                connected === null ? "bg-zinc-800 text-zinc-400" : connected ? "bg-green-900/30 text-green-400" : "bg-red-900/30 text-red-400"
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${connected === null ? "bg-zinc-400" : connected ? "bg-green-400" : "bg-red-400"}`} />
              {connected === null ? "..." : connected ? "Online" : "Offline"}
            </span>
            <button onClick={() => setLogVisible(!logVisible)} className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100" title="Toggle logs">
              <Terminal size={16} />
            </button>
            <button onClick={() => setHelpOpen(true)} className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100" title="Help">
              <HelpCircle size={16} />
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>

      {/* Logger modal */}
      <AnimatePresence>
        {logVisible && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-0 right-0 w-[540px] max-h-[320px] bg-zinc-900 border border-zinc-700 rounded-tl-xl shadow-2xl z-50 flex flex-col"
          >
            <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-700">
              <span className="text-xs font-medium text-zinc-300">Console Logs</span>
              <div className="flex gap-1">
                <button onClick={clearLogs} className="text-[10px] px-2 py-0.5 rounded bg-zinc-700 text-zinc-300 hover:text-zinc-100">Clear</button>
                <button onClick={() => setLogVisible(false)} className="p-0.5 text-zinc-400 hover:text-zinc-100"><X size={14} /></button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2 font-mono text-[12px] leading-relaxed">
              {logs.length === 0 && <span className="text-zinc-500">No logs yet...</span>}
              {logs.map((log, i) => (
                <div key={i} className={log.level === "error" ? "text-red-400" : log.level === "warn" ? "text-amber-400" : "text-zinc-300"}>
                  <span className="text-zinc-500">{log.timestamp}</span> {log.message}
                </div>
              ))}
              <div ref={logBottomRef} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Help modal */}
      <AnimatePresence>
        {helpOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={() => setHelpOpen(false)}>
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
              className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 max-w-lg w-full mx-4 max-h-[70vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-zinc-100">Help</h2>
                <button onClick={() => setHelpOpen(false)} className="p-1 text-zinc-400 hover:text-zinc-100"><X size={18} /></button>
              </div>
              <div className="space-y-3 text-sm text-zinc-300">
                <p><strong className="text-zinc-100">Giskard Red-Team Node</strong> runs automated adversarial scans against local LLM agents using the Giskard library.</p>
                <div>
                  <p className="text-zinc-200 font-medium mb-1">Pages:</p>
                  <ul className="list-disc list-inside space-y-1 text-zinc-300">
                    {NAV.map((n) => <li key={n.path}><strong className="text-zinc-100">{n.label}</strong></li>)}
                  </ul>
                </div>
                <p>Environment: <code className="text-amber-400">GISKARD_LLM_API_URL</code></p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
