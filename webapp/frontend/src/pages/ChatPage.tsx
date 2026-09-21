import { Bot, Loader2, MessageSquare, Send, User } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content:
        "Hello! I use the LLM configured in Settings - local (LM Studio / Ollama) or a cloud vendor. Ask me anything about Giskard scans or security analysis.",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [llmOk, setLlmOk] = useState<boolean | null>(null);
  const [llmModel, setLlmModel] = useState("");
  const [llmProvider, setLlmProvider] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadLlm = useCallback(async () => {
    try {
      const [s, d] = await Promise.all([api.getSettings(), api.detectLlm()]);
      const cloud = ["openai", "anthropic", "azure"].includes(s.llm_provider || "");
      setLlmModel(s.llm_model || d.model || "");
      setLlmProvider(s.llm_provider || d.provider || "");
      setLlmOk(cloud ? !!s.llm_model : d.success);
    } catch {
      setLlmOk(false);
    }
  }, []);

  useEffect(() => {
    loadLlm();
  }, [loadLlm]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = async () => {
    if (!input.trim() || loading) return;
    const userMsg: Message = { role: "user", content: input.trim() };
    const history = [...messages, userMsg].filter((m) => m.content.length < 4000).slice(-20);
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    // Via the backend proxy: keys stay server-side, any vendor works.
    try {
      const res = await api.chat(history.map((m) => ({ role: m.role, content: m.content })));
      setMessages((prev) => [...prev, { role: "assistant", content: res.content || "(empty response)" }]);
      if (res.model) {
        setLlmModel(res.model.replace(/^openai\/|^anthropic\/|^azure\//, ""));
        setLlmProvider(res.provider || "");
      }
      setLlmOk(true);
    } catch (e: any) {
      const msg = String(e?.message || "Chat failed.");
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: /no llm configured/i.test(msg)
            ? "No LLM configured yet. Go to Settings, pick a provider + model (and key for cloud vendors), Save - then chat here."
            : `Error: ${msg} Check Settings - provider ${llmProvider || "unknown"}, model ${llmModel || "none"}.`,
        },
      ]);
    }
    setLoading(false);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      <h1 className="text-2xl font-bold text-zinc-100 mb-4 flex items-center gap-2 flex-shrink-0">
        <MessageSquare className="text-amber-500" size={24} />
        Chat
      </h1>

      {/* LLM status - driven by backend Settings, never hardcoded */}
      <div className="mb-4 flex items-center gap-2 text-xs">
        <span className={`w-2 h-2 rounded-full ${llmOk ? "bg-green-500" : llmOk === false ? "bg-red-500" : "bg-zinc-500"}`} />
        <span className="text-zinc-400">
          {llmOk && llmModel ? `${llmProvider || "LLM"} - ${llmModel}` : llmOk ? "LLM detected, pick a model in Settings" : "No LLM detected"}
        </span>
        {(!llmOk || !llmModel) && (
          <Link to="/settings" className="text-amber-400 hover:underline">Open Settings</Link>
        )}
      </div>
      {llmOk === false && (
        <div className="mb-4 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 text-sm text-amber-400">
          No LLM reachable. Start LM Studio (:1234) or Ollama (:11434) - or configure a cloud vendor + key in
          Settings.
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-3 mb-4 pr-2">
        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : ""}`}>
            <div className={`flex gap-3 max-w-[80%] ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                  msg.role === "user" ? "bg-amber-500/20" : "bg-zinc-800"
                }`}
              >
                {msg.role === "user" ? (
                  <User size={14} className="text-amber-400" />
                ) : (
                  <Bot size={14} className="text-zinc-300" />
                )}
              </div>
              <div
                className={`rounded-xl px-4 py-2.5 text-sm ${
                  msg.role === "user"
                    ? "bg-amber-600/20 border border-amber-500/20 text-zinc-200"
                    : "bg-zinc-800/50 border border-zinc-800 text-zinc-300"
                }`}
              >
                {msg.content}
              </div>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center">
              <Bot size={14} className="text-zinc-300" />
            </div>
            <div className="rounded-xl px-4 py-2.5 bg-zinc-800/50 border border-zinc-800">
              <Loader2 size={14} className="animate-spin text-zinc-500" />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex gap-2 flex-shrink-0">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Ask about scan results, security analysis..."
          className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-zinc-200 placeholder-zinc-400 focus:outline-none focus:border-amber-500/50"
        />
        <button
          onClick={send}
          disabled={loading || !input.trim()}
          className="p-2.5 bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-700 rounded-lg transition-colors"
        >
          <Send size={16} className="text-black" />
        </button>
      </div>
    </div>
  );
}
