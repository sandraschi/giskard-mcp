"""Unified local + cloud LLM provider registry, keystore, and chat proxy.

Fleet-standard contract (see mcp-central-docs/standards/WEBAPP_SOTA_STANDARDS.md
section VI + pilot arxiv-mcp llm_providers.py): the webapp never talks to
providers from the browser. All traffic goes through the backend, and API keys
live in a 0600 keystore under data/ (or env vars, which win).

Provider IDs: ollama, lmstudio, vllm (local) + openai, anthropic, azure (cloud).
"""

from __future__ import annotations

import contextlib
import json
import logging
import os
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import httpx

logger = logging.getLogger("giskardmcp.llm_providers")

LOCAL_PROBE_TIMEOUT = 3.0
CLOUD_TIMEOUT = 30.0
CHAT_TIMEOUT = 120.0
KEYSTORE_NAME = "llm_keys.json"
ANTHROPIC_VERSION = "2023-06-01"
OLLAMA_NUM_CTX = 32768

PROVIDERS: tuple[dict[str, Any], ...] = (
    {
        "id": "ollama",
        "label": "Ollama",
        "kind": "local",
        "base_url": "http://127.0.0.1:11434",
        "chat_path": "/api/chat",
        "models_path": "/api/tags",
        "tag_style": "ollama",
        "key_env": None,
        "curated": [],
    },
    {
        "id": "lmstudio",
        "label": "LM Studio",
        "kind": "local",
        "base_url": "http://127.0.0.1:1234",
        "chat_path": "/v1/chat/completions",
        "models_path": "/v1/models",
        "tag_style": "openai",
        "key_env": None,
        "curated": [],
    },
    {
        "id": "vllm",
        "label": "vLLM",
        "kind": "local",
        "base_url": "http://127.0.0.1:8000",
        "chat_path": "/v1/chat/completions",
        "models_path": "/v1/models",
        "tag_style": "openai",
        "key_env": None,
        "curated": [],
    },
    {
        "id": "openai",
        "label": "OpenAI",
        "kind": "cloud",
        "base_url": "https://api.openai.com/v1",
        "chat_path": "/chat/completions",
        "models_path": "/models",
        "tag_style": "openai",
        "key_env": "OPENAI_API_KEY",
        "curated": ["gpt-4o", "gpt-4o-mini"],
    },
    {
        "id": "anthropic",
        "label": "Anthropic",
        "kind": "cloud",
        "base_url": "https://api.anthropic.com",
        "chat_path": "/v1/messages",
        "models_path": "/v1/models",
        "tag_style": "anthropic",
        "key_env": "ANTHROPIC_API_KEY",
        "curated": ["claude-sonnet-4-0", "claude-opus-4-0"],
    },
    {
        "id": "azure",
        "label": "Azure OpenAI",
        "kind": "cloud",
        "base_url": "",
        "chat_path": "/openai/deployments/{model}/chat/completions?api-version={api_version}",
        "models_path": "",
        "tag_style": "azure",
        "key_env": "AZURE_API_KEY",
        "curated": [],
    },
)


def get_provider(provider_id: str) -> dict[str, Any] | None:
    for row in PROVIDERS:
        if row["id"] == provider_id:
            return row
    return None


def require_provider(provider_id: str) -> dict[str, Any]:
    row = get_provider(provider_id)
    if row is None:
        raise LLMProviderError(provider_id, "unknown provider")
    return row


class LLMProviderError(ValueError):
    """Short-message provider errors (message kept in-class per TRY003)."""

    def __init__(self, short: str, detail: str = ""):
        super().__init__(short)
        self.detail = detail

    def __str__(self) -> str:
        base = super().__str__()
        return f"{base} ({self.detail})" if self.detail else base


def _data_dir() -> Path:
    d = Path(__file__).resolve().parent.parent.parent / "data"
    d.mkdir(parents=True, exist_ok=True)
    return d


def keystore_path() -> Path:
    return _data_dir() / KEYSTORE_NAME


def _read_keystore() -> dict[str, str]:
    path = keystore_path()
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        logger.warning("llm keystore unreadable (%s); treating as empty", exc)
        return {}
    return {k: v for k, v in data.items() if isinstance(v, str) and v}


def _write_keystore(entries: dict[str, str]) -> None:
    path = keystore_path()
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(entries, indent=2), encoding="utf-8")
    try:
        tmp.chmod(0o600)
    except OSError:
        logger.debug("chmod 0600 on keystore failed (non-POSIX fs); continuing")
    tmp.replace(path)
    with contextlib.suppress(OSError):
        path.chmod(0o600)


def get_key(provider_id: str) -> str:
    """Resolve an API key: env var first, then keystore. Empty when unset."""
    row = require_provider(provider_id)
    env_name = row.get("key_env")
    if env_name:
        value = os.environ.get(env_name, "").strip()
        if value:
            return value
    return _read_keystore().get(provider_id, "")


def is_configured(provider_id: str) -> bool:
    """True when a cloud provider has a key available. Locals need no key."""
    row = require_provider(provider_id)
    if row["kind"] == "local":
        return True
    return bool(get_key(provider_id))


def keys_configured() -> dict[str, bool]:
    return {r["id"]: is_configured(r["id"]) for r in PROVIDERS if r["kind"] == "cloud"}


def save_key(provider_id: str, api_key: str) -> None:
    row = require_provider(provider_id)
    if row["kind"] != "cloud":
        raise LLMProviderError(provider_id, "takes no API key")
    key = (api_key or "").strip()
    if not key:
        raise LLMProviderError(provider_id, "empty API key")
    entries = _read_keystore()
    entries[provider_id] = key
    _write_keystore(entries)


def delete_key(provider_id: str) -> bool:
    require_provider(provider_id)
    entries = _read_keystore()
    if provider_id not in entries:
        return False
    del entries[provider_id]
    _write_keystore(entries)
    return True


def migrate_legacy_key(legacy_key: str) -> str | None:
    """One-time move of a key stored in app_settings.json into the keystore.

    Returns the provider id it was attached to, or None when there was no
    usable legacy key. Callers clear the legacy field afterwards.
    """
    key = (legacy_key or "").strip()
    if not key or key == "not-needed":
        return None
    provider = os.environ.get("GISKARD_LEGACY_KEY_PROVIDER", "").strip()
    if provider not in ("openai", "anthropic", "azure"):
        provider = None
    if provider is None:
        # No provider tag survived -- attach to every cloud row missing a key
        # only when exactly one cloud provider exists is ambiguous; instead
        # refuse to guess and let the user re-enter per provider.
        return None
    try:
        has_key = bool(get_key(provider))
        if not has_key:
            save_key(provider, key)
    except LLMProviderError:
        return None
    else:
        return provider


def public_provider_info() -> list[dict[str, Any]]:
    """Registry rows safe for GET responses: capability flags, never key bytes."""
    return [
        {
            "id": r["id"],
            "label": r["label"],
            "kind": r["kind"],
            "base_url": r["base_url"],
            "needs_key": r["kind"] == "cloud",
            "key_env": r.get("key_env"),
            "configured": is_configured(r["id"]),
        }
        for r in PROVIDERS
    ]


def _parse_model_list(tag_style: str, payload: Any) -> list[str]:
    if not isinstance(payload, dict):
        return []
    if tag_style == "ollama":
        models = payload.get("models") or []
        return sorted({m.get("name", "") for m in models if isinstance(m, dict) and m.get("name")})
    if tag_style == "anthropic":
        data = payload.get("data") or []
        return sorted({m.get("id", "") for m in data if isinstance(m, dict) and m.get("id")})
    if tag_style == "azure":
        return []
    data = payload.get("data") or []
    return sorted({m.get("id", "") for m in data if isinstance(m, dict) and m.get("id")})


async def probe_local(provider_id: str, base_url: str = "") -> tuple[bool, list[str]]:
    """Probe a local engine (fast timeout). Returns (reachable, models)."""
    row = require_provider(provider_id)
    if row["kind"] != "local":
        raise LLMProviderError(provider_id, "not a local provider")
    url = (base_url or row["base_url"]).rstrip("/") + row["models_path"]
    try:
        async with httpx.AsyncClient(timeout=LOCAL_PROBE_TIMEOUT) as client:
            resp = await client.get(url)
    except Exception as exc:
        logger.debug("local probe %s failed: %s", provider_id, exc)
        return False, []
    if resp.status_code >= 500:
        return False, []
    try:
        models = _parse_model_list(row["tag_style"], resp.json())
    except Exception:
        models = []
    return True, models


async def probe_all_locals() -> dict[str, dict[str, Any]]:
    """Probe ollama + lmstudio + vllm concurrently. Never raises."""
    import asyncio

    async def one(pid: str) -> tuple[str, dict[str, Any]]:
        try:
            ok, models = await probe_local(pid)
        except LLMProviderError:
            return pid, {"reachable": False, "models": []}
        return pid, {"reachable": ok, "models": models}

    results = await asyncio.gather(*[one(r["id"]) for r in PROVIDERS if r["kind"] == "local"])
    return dict(results)


async def list_models(provider_id: str, endpoint: str = "", api_key: str = "") -> dict[str, Any]:
    """Model list with source flag. Cloud: live when keyed, else curated.

    api_key overrides the stored/env key for this call only (lets the Test
    button validate a typed-but-unsaved key). Never persisted here.
    """
    row = require_provider(provider_id)
    if row["kind"] == "local":
        reachable, models = await probe_local(provider_id, endpoint)
        return {"provider": provider_id, "models": models, "source": "live" if reachable else "none"}
    if provider_id == "azure":
        return {"provider": provider_id, "models": [], "source": "none", "note": "Enter the deployment name."}
    key = (api_key or "").strip() or get_key(provider_id)
    if not key:
        return {
            "provider": provider_id,
            "models": list(row["curated"]),
            "source": "curated",
            "key_missing": True,
            "note": "Save a key for the live list. Curated names still work once keyed.",
        }
    url = row["base_url"] + row["models_path"]
    headers = _auth_headers(row, key)
    if provider_id == "anthropic":
        headers["anthropic-version"] = ANTHROPIC_VERSION
    try:
        async with httpx.AsyncClient(timeout=CLOUD_TIMEOUT) as client:
            resp = await client.get(url, headers=headers)
            resp.raise_for_status()
            models = _parse_model_list(row["tag_style"], resp.json())
    except httpx.HTTPStatusError as exc:
        status = exc.response.status_code if exc.response is not None else "?"
        logger.warning("live model list for %s HTTP %s; curated fallback", provider_id, status)
        if status in (401, 403):
            error = f"{row['label']} rejected the key (HTTP {status}) -- check the key, then Save and Test again."
        else:
            error = f"{row['label']} HTTP {status}."
        return {"provider": provider_id, "models": list(row["curated"]), "source": "curated", "error": error}
    except Exception as exc:
        logger.warning("live model list for %s failed (%s); curated fallback", provider_id, exc)
        return {
            "provider": provider_id,
            "models": list(row["curated"]),
            "source": "curated",
            "error": f"{row['label']} unreachable ({exc})"[:200],
        }
    if not models:
        return {"provider": provider_id, "models": list(row["curated"]), "source": "curated"}
    return {"provider": provider_id, "models": models, "source": "live"}


def _auth_headers(row: dict[str, Any], api_key: str) -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if row["id"] == "anthropic":
        headers["x-api-key"] = api_key
    elif row["kind"] == "cloud":
        headers["Authorization"] = f"Bearer {api_key}"
    return headers


def _to_anthropic(model: str, messages: list[dict[str, Any]]) -> dict[str, Any]:
    system_parts: list[str] = []
    converted: list[dict[str, Any]] = []
    for msg in messages:
        role = msg.get("role", "user")
        content = str(msg.get("content", ""))
        if role == "system":
            system_parts.append(content)
        elif role in ("user", "assistant"):
            converted.append({"role": role, "content": content})
        else:
            converted.append({"role": "user", "content": content})
    body: dict[str, Any] = {"model": model, "max_tokens": 1024, "messages": converted}
    if system_parts:
        body["system"] = "\n\n".join(system_parts)
    return body


def _from_anthropic(payload: Any) -> str:
    blocks = (payload.get("content") or []) if isinstance(payload, dict) else []
    texts = [b.get("text", "") for b in blocks if isinstance(b, dict) and b.get("type") == "text"]
    return "".join(texts)


def _to_ollama_native(model: str, messages: list[dict[str, Any]]) -> dict[str, Any]:
    converted = [{"role": m.get("role", "user"), "content": str(m.get("content", ""))} for m in messages]
    return {"model": model, "messages": converted, "stream": False, "options": {"num_ctx": OLLAMA_NUM_CTX}}


def _from_ollama_native(payload: Any) -> str:
    if not isinstance(payload, dict):
        return ""
    return str((payload.get("message") or {}).get("content", ""))


def _openai_body(model: str, messages: list[dict[str, Any]]) -> dict[str, Any]:
    return {"model": model, "messages": messages, "stream": False}


def _clean_messages(messages: Any) -> list[dict[str, Any]]:
    clean = []
    for m in messages or []:
        if isinstance(m, dict):
            clean.append({"role": m.get("role", "user"), "content": str(m.get("content", ""))[:6000]})
    return clean[:20]


async def chat_complete(provider_id: str, model: str, messages: list[dict[str, Any]], endpoint: str = "") -> str:
    """Non-streaming chat via the backend proxy. Returns assistant text."""
    row = require_provider(provider_id)
    if not (model or "").strip():
        raise LLMProviderError(provider_id, "empty model name")
    key = get_key(provider_id) if row["kind"] == "cloud" else ""
    if row["kind"] == "cloud" and not key:
        raise LLMProviderError(provider_id, "no API key configured")
    headers = _auth_headers(row, key)
    clean = _clean_messages(messages)
    if provider_id == "anthropic":
        url = row["base_url"] + row["chat_path"]
        body = _to_anthropic(model, clean)
    elif provider_id == "ollama":
        url = (endpoint or row["base_url"]).rstrip("/") + row["chat_path"]
        body = _to_ollama_native(model, clean)
    elif provider_id == "azure":
        base = (endpoint or "").rstrip("/")
        if not base:
            raise LLMProviderError(provider_id, "endpoint URL required")
        api_version = os.environ.get("AZURE_API_VERSION", "2024-02-01")
        url = base + row["chat_path"].format(model=model, api_version=api_version)
        msgs = [m for m in clean if m["role"] != "system"]
        system = " ".join(m["content"] for m in clean if m["role"] == "system")
        if system:
            msgs = [{"role": "system", "content": system}] + msgs
        body = _openai_body(model, msgs)
    else:
        url = (endpoint or row["base_url"]).rstrip("/") + row["chat_path"]
        body = _openai_body(model, clean)
    try:
        async with httpx.AsyncClient(timeout=CHAT_TIMEOUT) as client:
            resp = await client.post(url, json=body, headers=headers)
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPStatusError as exc:
        status = exc.response.status_code if exc.response is not None else "?"
        raise LLMProviderError(provider_id, f"HTTP {status}") from exc
    except Exception as exc:
        raise LLMProviderError(provider_id, f"unreachable ({exc})") from exc
    if provider_id == "anthropic":
        return _from_anthropic(data)
    if provider_id == "ollama":
        return _from_ollama_native(data)
    try:
        return data["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, TypeError) as exc:
        raise LLMProviderError(provider_id, "unexpected response body") from exc


def _openai_sse_chunk(model: str, text: str) -> bytes:
    import time
    import uuid

    chunk = {
        "id": f"chatcmpl-{uuid.uuid4().hex[:12]}",
        "object": "chat.completion.chunk",
        "created": int(time.time()),
        "model": model,
        "choices": [{"index": 0, "delta": {"content": text}, "finish_reason": None}],
    }
    return ("data: " + json.dumps(chunk) + "\n\n").encode("utf-8")


async def chat_stream(
    provider_id: str, model: str, messages: list[dict[str, Any]], endpoint: str = ""
) -> AsyncIterator[bytes]:
    """Streaming chat as OpenAI-style SSE bytes. Falls back to one chunk."""
    row = require_provider(provider_id)
    key = get_key(provider_id) if row["kind"] == "cloud" else ""
    headers = _auth_headers(row, key)
    headers["Accept"] = "text/event-stream"
    clean = _clean_messages(messages)
    streamed = False
    if provider_id == "anthropic":
        url = row["base_url"] + row["chat_path"]
        body = _to_anthropic(model, clean)
        body["stream"] = True
        try:
            async with httpx.AsyncClient(timeout=CHAT_TIMEOUT) as client:
                async with client.stream("POST", url, json=body, headers=headers) as resp:
                    resp.raise_for_status()
                    async for line in resp.aiter_lines():
                        if not line.startswith("data: "):
                            continue
                        payload = line[6:].strip()
                        if payload in ("[DONE]", ""):
                            continue
                        try:
                            event = json.loads(payload)
                        except json.JSONDecodeError:
                            continue
                        if event.get("type") == "content_block_delta":
                            text = (event.get("delta") or {}).get("text", "")
                            if text:
                                streamed = True
                                yield _openai_sse_chunk(model, text)
        except Exception as exc:
            logger.warning("anthropic stream failed (%s); non-stream fallback", exc)
    elif provider_id not in ("azure",):
        if provider_id == "ollama":
            url = (endpoint or row["base_url"]).rstrip("/") + row["chat_path"]
            body = _to_ollama_native(model, clean)
            body["stream"] = True
        else:
            url = (endpoint or row["base_url"]).rstrip("/") + row["chat_path"]
            body = _openai_body(model, clean)
            body["stream"] = True
        try:
            async with httpx.AsyncClient(timeout=CHAT_TIMEOUT) as client:
                async with client.stream("POST", url, json=body, headers=headers) as resp:
                    resp.raise_for_status()
                    if provider_id == "ollama":
                        async for line in resp.aiter_lines():
                            text = line.strip()
                            if not text:
                                continue
                            try:
                                event = json.loads(text)
                            except json.JSONDecodeError:
                                continue
                            if event.get("done"):
                                continue
                            delta = str((event.get("message") or {}).get("content", ""))
                            if delta:
                                streamed = True
                                yield _openai_sse_chunk(model, delta)
                    else:
                        async for line in resp.aiter_lines():
                            if line.startswith("data: "):
                                streamed = True
                                yield (line + "\n\n").encode("utf-8")
        except Exception as exc:
            logger.warning("%s stream failed (%s); non-stream fallback", provider_id, exc)
    if not streamed:
        text = await chat_complete(provider_id, model, clean, endpoint)
        yield _openai_sse_chunk(model, text)
    yield b"data: [DONE]\n\n"


def _parse_nvidia_smi(stdout: str) -> list[dict[str, Any]]:
    gpus: list[dict[str, Any]] = []
    for line in (stdout or "").splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < 5:
            continue
        try:
            gpus.append(
                {
                    "index": int(parts[0]),
                    "name": ",".join(parts[1:-3]).strip(),
                    "total_mb": int(parts[-3]),
                    "used_mb": int(parts[-2]),
                    "free_mb": int(parts[-1]),
                }
            )
        except ValueError:
            continue
    return gpus


def gpu_vram() -> list[dict[str, Any]]:
    """Live per-GPU VRAM via nvidia-smi. Empty when unavailable. Never raises."""
    import subprocess

    try:
        proc = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=index,name,memory.total,memory.used,memory.free",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=10,
        )
    except (FileNotFoundError, OSError, subprocess.SubprocessError) as exc:
        logger.debug("nvidia-smi unavailable (%s)", exc)
        return []
    if proc.returncode != 0:
        return []
    return _parse_nvidia_smi(proc.stdout)


def _port_hint(base_url: str) -> int | None:
    try:
        return int(base_url.rsplit(":", 1)[1])
    except (ValueError, IndexError):
        return None


def explain_provider_error(exc_text: str, provider_id: str, model: str = "") -> str:
    """Turn raw vendor/client errors into actionable instructions."""
    text = (exc_text or "").strip()
    low = text.lower()
    label = (get_provider(provider_id) or {}).get("label", provider_id) or provider_id
    model_bit = f" '{model}'" if model else ""
    if "no models loaded" in low or "lms load" in low:
        return (
            f"{label} has no model loaded. Open {label} -> load{model_bit} for the API "
            "server (Developer tab -> select + Load), then rescan. Or pick an already-loaded "
            "model in Settings."
        )
    if "model_not_found" in low or ("not found" in low and "model" in low) or "does not exist" in low:
        return f"Model{model_bit} is not available on {label}. Re-detect in Settings and pick a name exactly as listed."
    if "incorrect api key" in low or "invalid api key" in low or "invalid_api_key" in low:
        return f"{label} rejected the API key. Paste a fresh key in Settings -> Save -> Test."
    if "401" in low or "403" in low or "unauthorized" in low or "forbidden" in low:
        return f"{label} refused the request ({model_bit or 'auth'}). Check the key in Settings."
    if "quota" in low or "rate limit" in low or "429" in low:
        return f"{label} rate-limited/quota-exhausted. Wait or switch provider, then retry."
    if "connect" in low or "refused" in low or "unreachable" in low or "timed out" in low or "timeout" in low:
        return f"Cannot reach {label}. Start the engine first, then retry."
    return text[:400] or f"{label} failed."


def onboarding_state() -> dict[str, Any]:
    clouds = {r["id"]: is_configured(r["id"]) for r in PROVIDERS if r["kind"] == "cloud"}
    configured = [pid for pid, ok in clouds.items() if ok]
    if configured:
        first = configured[0]
        recommendation = {"path": f"cloud:{first}", "reason": f"{first} key already configured."}
    else:
        recommendation = {
            "path": "local:ollama",
            "reason": "Free path: install Ollama, pull a 7-8b model, come back. Instant path: paste a cloud key in Settings.",
        }
    return {
        "locals": [
            {"id": r["id"], "label": r["label"], "port": _port_hint(r["base_url"])}
            for r in PROVIDERS
            if r["kind"] == "local"
        ],
        "clouds_configured": configured,
        "recommendation": recommendation,
    }
