import { FlaskConical, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { type SkillInfo, api } from "../api/client";

export function SkillsPage() {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [content, setContent] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await api.skills.list();
      setSkills(data.skills);
    } catch {}
    setLoading(false);
  }, []);

  const loadSkill = useCallback(async (name: string) => {
    setSelected(name);
    setContent("Loading...");
    try {
      const data = await api.skills.get(name);
      setContent(data.content);
    } catch {
      setContent("Failed to load skill content.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <h1 className="text-2xl font-bold text-zinc-100 mb-6 flex items-center gap-2">
        <FlaskConical className="text-amber-500" size={24} />
        Skills
      </h1>

      {loading && <div className="text-zinc-300 text-sm">Loading...</div>}

      {!loading && skills.length === 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 text-center">
          <p className="text-zinc-300 text-sm">
            No skills registered. Skills become available when the server exposes them via MCP Resources.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="md:col-span-1 space-y-1">
          {skills.map((s) => (
            <button
              key={s.name}
              onClick={() => loadSkill(s.name)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                selected === s.name
                  ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                  : "text-zinc-300 hover:text-zinc-200 hover:bg-zinc-800"
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>

        <div className="md:col-span-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 min-h-[300px]">
          {content === null ? (
            <p className="text-zinc-300 text-sm">Select a skill to view its content.</p>
          ) : content === "Loading..." ? (
            <div className="flex items-center gap-2 text-zinc-300 text-sm">
              <Loader2 size={14} className="animate-spin" /> Loading...
            </div>
          ) : (
            <div className="prose prose-invert prose-sm max-w-none">
              <ReactMarkdown>{content}</ReactMarkdown>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
