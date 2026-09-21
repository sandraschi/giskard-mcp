# Onboarding — connect an LLM first

Giskard scans need an LLM judge to grade attacks. Without one, every scan
fails fast with `No LLM configured`. You have two paths — local (free) or
cloud (key). Nothing else to install: no account, no payment for local.

## Path 1 — Local, free (recommended)

**LM Studio** (easiest model picker):

1. Download from [lmstudio.ai](https://lmstudio.ai) and install.
2. Download a chat model (7-8b class is enough, e.g. `deepseek-r1-distill-qwen-7b`).
   Avoid embedding models (`*embed*`) — they can't judge or chat.
3. Start LM Studio's API server (Developer tab → Start Server, port 1234).
4. In this app: Settings → Re-detect → pick the model from the dropdown → Save.

**Ollama** (terminal-friendly):

```powershell
winget install Ollama.Ollama
ollama pull llama3.2
ollama serve   # :11434
```

Then Settings → Re-detect → pick `llama3.2` → Save.

## Path 2 — Cloud vendor key

Settings → Provider → OpenAI / Anthropic / Azure → paste the key → Save.
The key is stored server-side only and never sent to the browser. Env-var
fallback works too: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `AZURE_API_KEY`.
Azure additionally needs its endpoint URL in the URL field and the
*deployment name* (not the model name) in the Model field.

## Sanity check

Settings shows the detected provider and model count; Chat answers you;
a scan leaves `detecting-llm` and reaches `scanning`. If Chat says "No LLM
configured", the provider/model pair isn't saved yet — Save first.

## Pitfalls

- LM Studio API server must actually be ON (port 1234) — installing the app
  is not enough.
- A model that won't load (too big for VRAM, not downloaded) fails at scan
  time with `Failed to load model`. Pick a smaller one.
- Embedding models appear first in some catalogs and can't judge. The app
  skips `*embed*` when auto-picking, but if you hand-pick one, that's on you.
