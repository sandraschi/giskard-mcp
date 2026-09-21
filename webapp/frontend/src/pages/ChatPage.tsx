import { Bot, Loader2, MessageSquare, Send, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { chatComplete, streamChat, type ChatMessage } from "../lib/provider";
import { subscribeLlmSelectionSync, useLlmStore } from "../store/llm";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export function ChatPage() {
  const llm = useLlmStore();
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content:
        "Hello! I use the LLM selected in Settings - local engines are free, cloud vendors need a key. Ask me about Giskard scans or security analysis.",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!llm.selectedProvider) llm.probeAll();
    return subscribeLlmSelectionSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

  const ready = !!llm.selectedProvider && !!llm.selectedModel;

  const send = async () => {
    if (!input.trim() || loading || !ready) return;
    const userMsg: Message = { role: "user", content: input.trim() };
    const history: ChatMessage[] = [...messages, userMsg]
      .filter((m) => m.content.length < 4000)
      .slice(-20)
      .map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);
    setStreaming("");

    const provider = llm.selectedProvider;
    const model = llm.selectedModel;
    try {
      let acc = "";
      await streamChat(
        provider,
        model,
        [{ role: "system", content: "You help with Giskard adversarial scan results and LLM security analysis." }, ...history],
        (text) => {
          acc += text;
          setStreaming(acc);
        },
      );
      const finalText = acc.trim();
      setStreaming("");
      setMessages((prev) => [...prev, { role: "assistant", content: finalText || "(empty response)" }]);
    } catch {
      // Stream failed (or is unsupported) - fall back to one-shot.
      try {
        const text = await chatComplete(provider, model, [
          { role: "system", content: "You help with Giskard adversarial scan results and LLM security analysis." },
          ...history,
        ]);
        setStreaming("");
        setMessages((prev) => [...prev, { role: "assistant", content: text || "(empty response)" }]);
      } catch (e: any) {
        setStreaming("");
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `Error: ${e?.message || "Chat failed."} Check Settings.` },
        ]);
      }
    }
    setLoading(false);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      <h1 className="text-2xl font-bold text-zinc-100 mb-4 flex items-center gap-2 flex-shrink-0">
        <MessageSquare className="text-amber-500" size={24} />
        Chat
      </h1>

      {/* Provider/model status - from the shared LLM store */}
      <div className="mb-4 flex items-center gap-2 text-xs">
        <span className={`w-2 h-2 rounded-full ${ready ? "bg-green-500" : "bg-red-500"}`} />
        <span className="text-zinc-400">
          {ready ? `${llm.selectedProvider} - ${llm.selectedModel}` : "No LLM selected"}
        </span>
        {!ready && (
          <Link to="/settings" className="text-amber-400 hover:underline">Open Settings</Link>
        )}
      </div>
      {!ready && (
        <div className="mb-4 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 text-sm text-amber-400">
          No usable LLM. Pick a detected local engine or a keyed cloud vendor in Settings.
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
        {(loading || streaming) && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center">
              <Bot size={14} className="text-zinc-300" />
            </div>
            <div className="rounded-xl px-4 py-2.5 bg-zinc-800/50 border border-zinc-800 text-sm text-zinc-300 max-w-[80%]">
              {streaming || <Loader2 size={14} className="animate-spin text-zinc-500" />}
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
          placeholder={ready ? "Ask about scan results, security analysis..." : "Select an LLM in Settings first..."}
          disabled={!ready}
          className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-zinc-200 placeholder-zinc-400 focus:outline-none focus:border-amber-500/50 disabled:opacity-50"
        />
        <button
          onClick={send}
          disabled={loading || !input.trim() || !ready}
          className="p-2.5 bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-700 rounded-lg transition-colors"
        >
          <Send size={16} className="text-black" />
        </button>
      </div>
    </div>
  );
}
