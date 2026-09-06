import { motion } from "framer-motion";
import { ChevronDown, ChevronRight, Code2, Cpu, Terminal } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { type ToolDef, api } from "../api/client";

export function ToolsHub() {
  const [tools, setTools] = useState<ToolDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.tools.list();
      setTools(data.tools);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <h1 className="text-2xl font-bold text-zinc-100 mb-6 flex items-center gap-2">
        <Code2 className="text-amber-500" size={24} />
        Tools Hub
      </h1>

      {loading && <div className="text-zinc-300 text-sm">Loading tools...</div>}

      {!loading && tools.length === 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 text-center">
          <Cpu size={40} className="mx-auto mb-3 text-zinc-700" />
          <p className="text-zinc-300 text-sm">No MCP tools discovered. Ensure the backend is connected.</p>
        </div>
      )}

      <div className="space-y-2">
        {tools.map((tool) => (
          <motion.div
            key={tool.name}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden"
          >
            <button
              onClick={() => setExpanded(expanded === tool.name ? null : tool.name)}
              className="w-full flex items-center gap-3 p-4 text-left hover:bg-zinc-800/30 transition-colors"
            >
              {expanded === tool.name ? (
                <ChevronDown size={16} className="text-amber-500" />
              ) : (
                <ChevronRight size={16} className="text-zinc-500" />
              )}
              <Terminal size={16} className="text-amber-500 flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-zinc-200">{tool.name}</p>
                <p className="text-xs text-zinc-300 truncate">{tool.description || "No description"}</p>
              </div>
            </button>

            {expanded === tool.name && (
              <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} className="border-t border-zinc-800 p-4">
                <p className="text-xs text-zinc-300 mb-2">{tool.description}</p>
                {tool.parameters && Object.keys(tool.parameters).length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-zinc-300 mb-1">Parameters</p>
                    <pre className="bg-zinc-950 rounded-lg p-3 text-[11px] text-zinc-300 font-mono overflow-x-auto">
                      {JSON.stringify(tool.parameters, null, 2)}
                    </pre>
                  </div>
                )}
              </motion.div>
            )}
          </motion.div>
        ))}
      </div>
    </div>
  );
}
