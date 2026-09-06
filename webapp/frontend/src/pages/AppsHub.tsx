import { Globe, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

const FLEET_PORTS = [
  { name: "Calibre MCP", port: 10720 },
  { name: "Plex MCP", port: 10740 },
  { name: "Email MCP", port: 10812 },
  { name: "Avatar MCP", port: 10792 },
  { name: "Docs MCP", port: 10794 },
  { name: "Blender MCP", port: 10848 },
  { name: "GitHub MCP", port: 10703 },
  { name: "FreeCAD MCP", port: 10944 },
];

interface FleetApp {
  name: string;
  port: number;
  ok: boolean;
}

export function AppsHub() {
  const [apps, setApps] = useState<FleetApp[]>([]);
  const [scanning, setScanning] = useState(true);

  const scan = useCallback(async () => {
    setScanning(true);
    const results: FleetApp[] = [];
    for (const app of FLEET_PORTS) {
      try {
        const res = await fetch(`http://127.0.0.1:${app.port}/health`, {
          signal: AbortSignal.timeout(2000),
        });
        results.push({ ...app, ok: res.ok });
      } catch {
        results.push({ ...app, ok: false });
      }
    }
    setApps(results);
    setScanning(false);
  }, []);

  useEffect(() => {
    scan();
  }, [scan]);

  return (
    <div>
      <h1 className="text-2xl font-bold text-zinc-100 mb-6 flex items-center gap-2">
        <Globe className="text-amber-500" size={24} />
        Apps Hub
      </h1>

      {scanning && (
        <div className="flex items-center gap-2 text-zinc-300 text-sm mb-4">
          <Loader2 size={14} className="animate-spin" /> Scanning fleet...
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {apps.map((app) => (
          <a
            key={app.port}
            href={`http://127.0.0.1:${app.port}`}
            target="_blank"
            className={`rounded-xl border p-4 transition-colors ${
              app.ok
                ? "border-zinc-800 bg-zinc-900/50 hover:border-green-500/30"
                : "border-zinc-800/50 bg-zinc-900/20 opacity-50"
            }`}
            rel="noreferrer"
          >
            <div className="flex items-center justify-between mb-2">
              <span className={`text-sm font-medium ${app.ok ? "text-zinc-200" : "text-zinc-500"}`}>{app.name}</span>
              <span className={`w-2 h-2 rounded-full ${app.ok ? "bg-green-500" : "bg-zinc-700"}`} />
            </div>
            <p className="text-[10px] text-zinc-500">Port {app.port}</p>
          </a>
        ))}
      </div>
    </div>
  );
}
