"""Fleet MCP vulnerability scanner powered by Giskard.

Discovers MCP servers on the local network, wraps them as Giskard models,
and runs automated adversarial red-teaming scans using Giskard's LLM detectors.
LM Studio is auto-detected for Giskard's internal LLM calls.
"""

import asyncio
import contextlib
import logging
import os
from pathlib import Path

import httpx
import pandas as pd

from .config import settings

logger = logging.getLogger("giskardmcp.scanner")

FLEET_PORTS = list(range(settings.fleet_port_start, settings.fleet_port_end + 1))

# Scan profiles (frontend multi-select) -> Giskard detector tags for
# ``giskard.scan(only=[...])``. Verified against the installed Giskard 2.x
# detector registry (see DetectorRegistry._tags). Unknown names are ignored.
SCAN_PROFILES: dict[str, list[str]] = {
    "prompt_injection": ["prompt_injection", "jailbreak"],
    "information_disclosure": ["information_disclosure", "data_leakage"],
    "harmful_content": ["harmfulness", "llm_harmful_content"],
    "hallucination": ["hallucination", "faithfulness", "misinformation"],
    "bias": ["ethical_bias", "stereotypes", "discrimination"],
    "boundary_testing": ["robustness", "control_chars_injection", "text_perturbation"],
    "role_play": ["jailbreak"],
}


def pick_chat_model(models: list[str]) -> str:
    """Default model choice: first non-embedding model (embedding models
    can't judge or chat). Falls back to the first entry."""
    for m in models or []:
        name = m.lower()
        if "embed" not in name:
            return m
    return (models or [""])[0]


async def list_provider_models(provider: str = "local", url: str = "", api_key: str = "") -> dict:
    """Model catalog for a provider. Keys stay server-side. Never raises.

    local/lm-studio/ollama: live detection. custom: the endpoint's /models.
    openai/anthropic: vendor list API with the stored/env key.
    azure: no list API -- returns [] with a note (enter the deployment name).
    """
    vendor = (provider or "local").strip() or "local"
    if vendor in ("lm-studio", "ollama", "local"):
        details = await detect_llm_details()
        return {"success": True, "provider": details.get("provider", "none"), "models": details.get("models", [])}
    if vendor == "custom":
        models = await _fetch_models((url or "").rstrip("/")) if url else []
        return {"success": True, "provider": "custom", "models": models}
    if vendor == "azure":
        return {
            "success": True,
            "provider": "azure",
            "models": [],
            "note": "Azure has no list API -- enter the deployment name.",
        }
    key = resolve_llm_key(vendor, api_key)
    if not key:
        return {"success": False, "provider": vendor, "models": [], "error": f"No API key for {vendor}"}
    try:
        headers: dict[str, str] = {}
        endpoint = ""
        if vendor == "openai":
            endpoint = "https://api.openai.com/v1/models"
            headers = {"Authorization": f"Bearer {key}"}
        elif vendor == "anthropic":
            endpoint = "https://api.anthropic.com/v1/models"
            headers = {"x-api-key": key, "anthropic-version": "2023-06-01"}
        else:
            return {"success": False, "provider": vendor, "models": [], "error": f"Unknown provider '{vendor}'"}
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(endpoint, headers=headers, params={"limit": 100} if vendor == "anthropic" else {})
            if r.status_code != 200:
                return {"success": False, "provider": vendor, "models": [], "error": f"Vendor API HTTP {r.status_code}"}
            data = r.json()
            items = data.get("data", []) if isinstance(data, dict) else []
            models = sorted({m.get("id", "") for m in items if isinstance(m, dict) and m.get("id")})
            return {"success": True, "provider": vendor, "models": models}
    except Exception as e:
        logger.warning("Model catalog for %s failed: %s", vendor, e)
        return {"success": False, "provider": vendor, "models": [], "error": str(e)[:200]}


def resolve_scan_tags(profiles: list[str] | str | None) -> list[str] | None:
    """Turn profile names into a Giskard ``only`` tag list. None = full scan."""
    if not profiles:
        return None
    if isinstance(profiles, str):
        profiles = [p.strip() for p in profiles.split(",") if p.strip()]
    tags: list[str] = []
    for p in profiles:
        tags.extend(SCAN_PROFILES.get(p, []))
    seen = list(dict.fromkeys(tags))
    return seen or None


# LLM vendors selectable in Settings. "local" covers LM Studio / Ollama /
# any OpenAI-compatible endpoint (no key needed). Cloud vendors need an API
# key (Settings, stored server-side only, or standard env vars).
LLM_VENDORS = ("local", "lm-studio", "ollama", "custom", "openai", "anthropic", "azure")

_VENDOR_KEY_ENV = {"openai": "OPENAI_API_KEY", "anthropic": "ANTHROPIC_API_KEY", "azure": "AZURE_API_KEY"}


class LLMConfigError(ValueError):
    """Missing vendor pieces. Carries what's needed; message stays short."""

    def __init__(self, vendor: str, need: str):
        super().__init__(vendor)
        self.vendor = vendor
        self.need = need

    def __str__(self) -> str:
        return f"{self.vendor}: needs {self.need}"


def is_cloud_vendor(provider: str) -> bool:
    return (provider or "") in ("openai", "anthropic", "azure")


def resolve_llm_key(provider: str, explicit: str = "") -> str:
    """API key precedence: Settings value > vendor env var > ''."""
    if (explicit or "").strip():
        return explicit.strip()
    env_var = _VENDOR_KEY_ENV.get(provider or "")
    return os.environ.get(env_var, "") if env_var else ""


def build_litellm_params(
    llm_url: str = "", llm_model: str = "", provider: str = "local", api_key: str = ""
) -> tuple[str, dict]:
    """Turn (url, model, vendor, key) into litellm (model, completion-kwargs).

    Raises ValueError when required pieces are missing. Never includes the
    key in any returned structure except the kwargs dict passed to litellm.
    """
    url = (llm_url or "").rstrip("/")
    model = (llm_model or "").strip()
    vendor = (provider or "local").strip() or "local"
    if vendor in ("lm-studio", "ollama"):
        vendor = "local"
    key = resolve_llm_key(vendor, api_key)

    if vendor == "openai":
        if not model or not key:
            raise LLMConfigError("openai", "model + key")
        return model, {"api_key": key}
    if vendor == "anthropic":
        if not model or not key:
            raise LLMConfigError("anthropic", "model + key")
        name = model if "/" in model else f"anthropic/{model}"
        return name, {"api_key": key}
    if vendor == "azure":
        if not model or not url or not key:
            raise LLMConfigError("azure", "endpoint + deployment + key")
        return f"azure/{model}", {
            "api_base": url,
            "api_key": key,
            "api_version": os.environ.get("AZURE_API_VERSION", "2024-02-01"),
        }
    # local / custom: OpenAI-compatible endpoint, no key needed.
    if not url or not model:
        raise LLMConfigError("local", "llm_url + llm_model")
    name = model if "/" in model else f"openai/{model}"
    return name, {"api_base": url, "api_key": key or "not-needed"}


def configure_giskard_llm(llm_url: str = "", llm_model: str = "", provider: str = "local", api_key: str = "") -> dict:
    """Point Giskard's eval LLM at the configured vendor + model.

    Local endpoints use LiteLLM's OpenAI-compatible path with no key.
    Cloud vendors use their litellm prefix with the stored/env key.
    Structured output stays off (local models lack JSON mode; evaluators
    fall back to text parsing with repair). Never raises, never logs keys.
    """
    try:
        from giskard.llm.client import set_llm_model

        name, params = build_litellm_params(llm_url, llm_model, provider, api_key)
        set_llm_model(name, disable_structured_output=True, **params)
    except Exception as e:
        logger.warning("Could not configure Giskard eval LLM: %s", e)
        return {"configured": False, "reason": str(e)}
    else:
        if llm_url:
            os.environ["GISKARD_LLM_API_URL"] = (llm_url or "").rstrip("/")
        logger.info("Giskard eval LLM -> vendor=%s model=%s", provider or "local", name)
        return {"configured": True, "model": name, "provider": provider or "local"}


def chat_completion(
    messages: list[dict],
    llm_url: str = "",
    llm_model: str = "",
    provider: str = "local",
    api_key: str = "",
    fallback_models: list[str] | None = None,
) -> dict:
    """One-shot chat completion through litellm (any vendor). For the Chat page.

    Tries the primary model then up to 2 fallbacks (a default pick is not
    guaranteed loadable -- LM Studio lists models it can then fail to load).
    Keeps API keys server-side -- the browser never sees them. Never raises.
    """
    try:
        import litellm

        candidates = [c for c in dict.fromkeys([llm_model, *(fallback_models or [])]) if (c or "").strip()][:3]
        clean = [
            {"role": m.get("role", "user"), "content": str(m.get("content", ""))[:6000]}
            for m in messages
            if isinstance(m, dict)
        ]
        result: dict = {"success": False, "error": "no model candidates"}
        for candidate in candidates:
            try:
                name, params = build_litellm_params(llm_url, candidate, provider, api_key)
                resp = litellm.completion(model=name, messages=clean, temperature=0.3, timeout=90, **params)
                msg = getattr(getattr(resp.choices[0], "message", None), "content", None) or ""
                text = msg.strip()
            except Exception as e:
                result = {"success": False, "error": str(e)[:500]}
                logger.info("Chat candidate %s failed, trying next", candidate)
                continue
            result = {
                "success": True,
                "content": text or "(empty response)",
                "model": name,
                "provider": provider or "local",
            }
            break
    except Exception as e:
        result = {"success": False, "error": str(e)[:500]}
    return result


async def _fetch_models(openai_base: str) -> list[str]:
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            r = await client.get(f"{openai_base}/models")
            if r.status_code == 200:
                data = r.json()
                items = data.get("data", []) if isinstance(data, dict) else []
                return [m.get("id", "") for m in items if isinstance(m, dict) and m.get("id")]
    except Exception:
        pass
    return []


async def _fetch_ollama_models(base: str) -> list[str]:
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            r = await client.get(f"{base}/api/tags")
            if r.status_code == 200:
                data = r.json()
                items = data.get("models", []) if isinstance(data, dict) else []
                return [m.get("name", "") for m in items if isinstance(m, dict) and m.get("name")]
    except Exception:
        pass
    return []


async def detect_llm_details() -> dict:
    details_url: str | None = None
    details_provider = "none"
    details_models: list[str] = []
    for url in [
        "http://127.0.0.1:1234/v1",
        "http://localhost:1234/v1",
    ]:
        try:
            async with httpx.AsyncClient(timeout=3) as client:
                r = await client.get(f"{url}/models")
                if r.status_code == 200:
                    os.environ["GISKARD_LLM_API_URL"] = url
                    details_models = await _fetch_models(url)
                    logger.info("Detected LM Studio at %s (%d models)", url, len(details_models))
                    return {"url": url, "provider": "lm-studio", "models": details_models}
        except Exception:
            continue
    for base in ["http://127.0.0.1:11434", "http://localhost:11434"]:
        try:
            async with httpx.AsyncClient(timeout=3) as client:
                r = await client.get(f"{base}/api/tags")
                if r.status_code == 200:
                    openai_url = f"{base}/v1"
                    os.environ["GISKARD_LLM_API_URL"] = openai_url
                    details_models = await _fetch_ollama_models(base)
                    logger.info("Detected Ollama at %s (%d models)", base, len(details_models))
                    return {"url": openai_url, "provider": "ollama", "models": details_models}
        except Exception:
            continue
    logger.warning("No local LLM detected (LM Studio :1234, Ollama :11434)")
    return {"url": details_url, "provider": details_provider, "models": details_models}


async def detect_llm() -> str | None:
    details = await detect_llm_details()
    return details["url"]


async def discover_servers() -> list[dict]:
    sem = asyncio.Semaphore(100)
    timeout = httpx.Timeout(1.0, connect=0.5)

    async def probe(client: httpx.AsyncClient, port: int) -> dict | None:
        async with sem:
            try:
                r = await client.get(f"http://127.0.0.1:{port}/health")
                if r.status_code == 200:
                    try:
                        data = r.json() if "json" in r.headers.get("content-type", "") else {}
                    except Exception:
                        data = {}
                    if not isinstance(data, dict):
                        data = {}
                    return {
                        "port": port,
                        "url": f"http://127.0.0.1:{port}",
                        "service": data.get("service") or data.get("name") or f"port-{port}",
                        "ok": True,
                        "mcp_available": True,
                    }
            except Exception:
                pass
            return None

    async with httpx.AsyncClient(timeout=timeout) as client:
        results = await asyncio.gather(*[probe(client, p) for p in FLEET_PORTS])
    return [r for r in results if r is not None]


class MCPConnectionError(ConnectionError):
    """Target MCP unreachable. Details ride along; message stays in-class."""

    def __init__(self, url: str, attempts: str):
        super().__init__(url)
        self.url = url
        self.attempts = attempts

    def __str__(self) -> str:
        return f"Cannot open MCP session at {self.url} ({self.attempts})"


def _flatten_mcp_error(exc: BaseException) -> str:
    """Turn client noise (anyio ExceptionGroups, cancel scopes, httpx wrappers) into one line."""
    parts: list[str] = []
    seen: set[int] = set()

    def text_of(e: BaseException) -> str:
        text = str(e).strip().splitlines()[0] if str(e).strip() else ""
        return text.split("For more information check:")[0].strip()

    def walk(e: BaseException) -> None:
        if id(e) in seen:
            return
        seen.add(id(e))
        subs = getattr(e, "exceptions", None)
        if subs:
            for s in subs:
                walk(s)
            return
        text = text_of(e)
        # Cancel scopes mask the real failure -- dig into the chain.
        if not text or "cancel scope" in text.lower() or text == type(e).__name__:
            cause = getattr(e, "__cause__", None) or getattr(e, "__context__", None)
            if isinstance(cause, BaseException):
                walk(cause)
                return
        if text and text not in parts:
            parts.append(text[:220])

    walk(exc)
    flat = "; ".join(parts) or type(exc).__name__
    if "401" in flat or "403" in flat or "unauthorized" in flat.lower():
        flat += " -- target requires authentication; this scanner supports open endpoints only"
    elif "404" in flat:
        flat += " -- not an MCP endpoint (wrong path?)"
    elif "connect" in flat.lower() or "refused" in flat.lower():
        flat += " -- target down or wrong port?"
    return flat


_PREFLIGHT_CACHE: dict[str, float] = {}
_PREFLIGHT_TTL = 120.0


async def _preflight_mcp(mcp_url: str) -> None:
    """One cheap initialize POST with our own timeout, before opening a session.

    The MCP clients can hang or collapse into cancel-scope noise on dead,
    authed, or non-MCP endpoints. This surfaces the exact cause first.
    Raises MCPConnectionError with a human message. Cached per URL (TTL).
    """
    import time

    now = time.monotonic()
    if now - _PREFLIGHT_CACHE.get(mcp_url, 0.0) < _PREFLIGHT_TTL:
        return
    body = {
        "jsonrpc": "2.0",
        "id": "giskard-preflight",
        "method": "initialize",
        "params": {
            "protocolVersion": "2025-03-26",
            "capabilities": {},
            "clientInfo": {"name": "giskard-mcp", "version": "0.1.0"},
        },
    }
    headers = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json"}
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(mcp_url, json=body, headers=headers)
    except Exception as e:
        raise MCPConnectionError(mcp_url, f"nothing listening here ({_flatten_mcp_error(e)})") from e
    if resp.status_code in (401, 403):
        raise MCPConnectionError(
            mcp_url,
            f"HTTP {resp.status_code} Unauthorized -- target requires authentication; "
            "this scanner supports open endpoints only",
        )
    if resp.status_code == 404:
        raise MCPConnectionError(mcp_url, "HTTP 404 -- not an MCP endpoint (wrong path? try /mcp or /sse)")
    if resp.status_code >= 400:
        raise MCPConnectionError(mcp_url, f"HTTP {resp.status_code} on initialize")
    _PREFLIGHT_CACHE[mcp_url] = now


async def _open_mcp_session(mcp_url: str):
    """Yield (read, write) for a target MCP server, any transport.

    Fleet servers speak Streamable HTTP (`/mcp`); older servers speak
    legacy SSE (`/sse`). Returns an async context manager plus a flag
    telling whether read/write need session.initialize() first.
    """
    from mcp.client.sse import sse_client
    from mcp.client.streamable_http import streamablehttp_client

    errors: list[str] = []
    try:
        client = streamablehttp_client(mcp_url, timeout=30)
        streams = await client.__aenter__()
        return client, streams[0], streams[1], errors
    except Exception as e:
        errors.append(f"streamable-http: {_flatten_mcp_error(e)}")
    try:
        client = sse_client(mcp_url, timeout=30)
        streams = await client.__aenter__()
        return client, streams[0], streams[1], errors
    except Exception as e:
        errors.append(f"sse: {_flatten_mcp_error(e)}")
    raise MCPConnectionError(mcp_url, "; ".join(errors))


async def fetch_tools_from_mcp(mcp_url: str) -> list[dict]:
    """Connect to an MCP server and list its tools (any transport)."""
    from mcp import ClientSession

    await _preflight_mcp(mcp_url)
    client, read, write, _errors = await _open_mcp_session(mcp_url)
    pending: MCPConnectionError | None = None
    try:
        async with ClientSession(read, write) as session:
            await session.initialize()
            result = await session.list_tools()
            tools = getattr(result, "tools", result)
            out = []
            for t in tools:
                raw_schema = getattr(t, "inputSchema", {})
                try:
                    schema_dict = dict(raw_schema) if isinstance(raw_schema, dict) else {}
                except Exception:
                    schema_dict = {}
                out.append(
                    {
                        "name": getattr(t, "name", str(t)),
                        "description": getattr(t, "description", ""),
                        "schema": str(raw_schema),
                        "schema_dict": schema_dict,
                    }
                )
            return out
    except MCPConnectionError as e:
        pending = e
        raise
    except BaseException as e:
        # anyio cancel scopes surface session-internal failures as
        # CancelledError. Only a cancel of OUR task may propagate.
        task = asyncio.current_task()
        if isinstance(e, asyncio.CancelledError) and task is not None and task.cancelling() > 0:
            raise
        pending = MCPConnectionError(mcp_url, _flatten_mcp_error(e))
        raise pending from e
    finally:
        # Session teardown can raise its own CancelledError that masks the
        # real failure. Prefer the explanation, unless OUR task is being
        # cancelled (job cancel must still propagate).
        try:
            await client.__aexit__(None, None, None)
        except asyncio.CancelledError:
            task = asyncio.current_task()
            if pending is not None and (task is None or task.cancelling() == 0):
                raise pending from None
            raise
        except Exception:
            pass


def _prompt_param(tools: list[dict], tool_name: str) -> str:
    """Pick the input field that carries free text for a target tool.

    Fleet tools rarely have a 'prompt' field, so map the attack text onto
    the most plausible string property instead of failing validation.
    """
    for t in tools:
        if t.get("name") != tool_name:
            continue
        props = (t.get("schema_dict") or {}).get("properties") or {}
        if not isinstance(props, dict) or not props:
            return "prompt"
        names = [str(k) for k in props]
        for want in ("prompt", "query", "text", "question", "message", "input", "q"):
            if want in names:
                return want
        for n in names:
            if isinstance(props.get(n), dict) and props[n].get("type") == "string":
                return n
        return names[0]
    return "prompt"


async def _call_mcp_tool_as(mcp_url: str, tool_name: str, arguments: dict) -> str:
    """Call an MCP tool with explicit arguments (any transport)."""
    from mcp import ClientSession

    try:
        await _preflight_mcp(mcp_url)
    except MCPConnectionError as e:
        return f"CALL_ERROR: {e}"
    client, read, write, _errors = await _open_mcp_session(mcp_url)
    try:
        async with ClientSession(read, write) as session:
            await session.initialize()
            try:
                result = await session.call_tool(tool_name, arguments=arguments)
                if hasattr(result, "content") and result.content:
                    parts = []
                    for item in result.content:
                        if hasattr(item, "text") and item.text:
                            parts.append(item.text)
                        elif hasattr(item, "data") and item.data:
                            parts.append(f"[binary: {len(item.data)} bytes]")
                    return "\n".join(parts) if parts else str(result)
                return str(result)
            except Exception as e:
                return f"CALL_ERROR: {_flatten_mcp_error(e)}"
    finally:
        # Worker-thread context: teardown noise must never kill the scan.
        with contextlib.suppress(Exception, asyncio.CancelledError):
            await client.__aexit__(None, None, None)


async def call_mcp_tool(mcp_url: str, tool_name: str, prompt: str) -> str:
    """Call an MCP tool with an adversarial prompt (any transport)."""
    return await _call_mcp_tool_as(mcp_url, tool_name, {"prompt": prompt})


def run_giskard_scan(
    agent_name: str,
    agent_description: str,
    mcp_url: str,
    tools: list[dict],
    profiles: list[str] | str | None = None,
    llm_url: str = "",
    llm_model: str = "",
    llm_provider: str = "local",
    llm_api_key: str = "",
) -> dict:
    """Wrap the MCP server as a Giskard model and run a scan.

    Giskard generates adversarial prompts, we route them through MCP tool calls,
    and Giskard evaluates the responses for vulnerabilities.

    profiles: scan-profile names (see SCAN_PROFILES) limiting which detector
        families run. None/empty = full suite.
    llm_url/llm_model/llm_provider/llm_api_key: eval LLM for Giskard's judges
        (any vendor from LLM_VENDORS). When url+model are given they are
        configured via set_llm_model; otherwise Giskard uses whatever was
        configured before (env/defaults).
    """
    import giskard

    if llm_url and llm_model:
        configure_giskard_llm(llm_url, llm_model, llm_provider, llm_api_key)

    def predict(df: pd.DataFrame) -> list[str]:
        """Giskard-compatible prediction: routes prompts through the MCP server."""
        tool_names = [t["name"] for t in tools]
        primary_tool = tool_names[0] if tool_names else "unknown"
        param = _prompt_param(tools, primary_tool)
        results = []
        for question in df["question"]:
            try:
                result = asyncio.run(_call_mcp_tool_as(mcp_url, primary_tool, {param: question}))
                results.append(result)
            except Exception as e:
                results.append(f"EXEC_ERROR: {e}")
        return results

    giskard_model = giskard.Model(
        model=predict,
        model_type="text_generation",
        name=agent_name,
        description=agent_description,
        feature_names=["question"],
    )

    only_tags = resolve_scan_tags(profiles)
    try:
        scan_results = giskard.scan(giskard_model, only=only_tags)
    except Exception as e:
        from .llm_providers import explain_provider_error

        raise RuntimeError(explain_provider_error(str(e), llm_provider, llm_model)) from e

    report_path = str(Path(settings.local_reports_dir) / f"{agent_name}_vulnerability_report.html")
    scan_results.to_html(report_path)

    issues = []
    if scan_results.has_issues():
        for issue in scan_results.issues:
            issues.append(
                {
                    "group": getattr(issue, "group", "unknown"),
                    "description": getattr(issue, "description", ""),
                    "severity": getattr(issue, "level", "unknown"),
                }
            )

    return {
        "success": True,
        "agent_name": agent_name,
        "has_issues": scan_results.has_issues(),
        "issue_count": len(issues),
        "issues": issues,
        "report_path": report_path,
        "profiles": profiles if isinstance(profiles, list) else [p for p in str(profiles or "").split(",") if p],
        "tags": only_tags or [],
    }
