import { Bot, Loader2, MessageSquare, Send, User } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

const OLLAMA_URL = "http://127.0.0.1:11434/api/generate";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content:
        "Hello! I'm connected to your local LLM (Ollama). Ask me anything about Giskard scans or security analysis.",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [ollamaOk, setOllamaOk] = useState<boolean | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const checkOllama = useCallback(async () => {
    try {
      const res = await fetch(`${OLLAMA_URL.replace("/api/generate", "")}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      });
      setOllamaOk(res.ok);
    } catch {
      setOllamaOk(false);
    }
  }, []);

  useEffect(() => {
    checkOllama();
  }, [checkOllama]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = async () => {
    if (!input.trim() || loading) return;
    const userMsg: Message = { role: "user", content: input.trim() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch(OLLAMA_URL, {
        method: "POST",
        body: JSON.stringify({
          model: "llama3.2",
          prompt: userMsg.content,
          stream: false,
        }),
        signal: AbortSignal.timeout(30000),
      });
      const data = await res.json();
      setMessages((prev) => [...prev, { role: "assistant", content: data.response || "(empty response)" }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Error: Could not reach Ollama. Make sure it's running on port 11434.",
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

      {/* Ollama status */}
      {ollamaOk === false && (
        <div className="mb-4 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 text-sm text-amber-400">
          Ollama not detected on port 11434. Install Ollama for local LLM chat, or configure a cloud provider in
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
