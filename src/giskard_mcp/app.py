"""Starlette HTTP app with REST API for the Giskard MCP webapp."""

import asyncio
import os
import time
import uuid
from pathlib import Path

from starlette.applications import Starlette
from starlette.middleware.cors import CORSMiddleware
from starlette.responses import FileResponse, JSONResponse
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles

from .config import settings
from .server import SCANS_STORE, mcp
from .store import (
    add_target,
    delete_report,
    delete_scan,
    load_app_settings,
    load_records,
    load_targets,
    normalize_scan,
    remove_target,
    save_app_settings,
    upsert_record,
)

BACKEND_PORT = settings.port
FRONTEND_PORT = BACKEND_PORT + 1
REPORTS_DIR = Path(settings.local_reports_dir)
START_TIME = time.time()

app_settings = load_app_settings()

# One-time migration: keys used to live in app_settings.json next to the
# provider tag. Move them into the 0600 keystore, then drop the field.
_migrated_key = (app_settings.pop("llm_api_key", "") or "").strip()
_migrated_provider = (app_settings.get("llm_provider") or "").strip()
if _migrated_key and _migrated_key != "not-needed" and _migrated_provider in ("openai", "anthropic", "azure"):
    try:
        from .llm_providers import get_key as _get_key
        from .llm_providers import save_key as _save_key

        if not _get_key(_migrated_provider):
            _save_key(_migrated_provider, _migrated_key)
        save_app_settings(app_settings)
    except Exception:
        pass

# Hydrate in-memory history from disk (idempotent across re-imports).
if not SCANS_STORE:
    SCANS_STORE.extend(load_records())

# Background scan jobs: job_id -> record. Tasks tracked separately for cancel.
JOBS: dict[str, dict] = {}
_JOB_TASKS: dict[str, asyncio.Task] = {}


async def health(_request):
    return JSONResponse(
        {
            "ok": True,
            "version": "0.1.0",
            "service": "giskard-mcp",
            "port": BACKEND_PORT,
            "uptime_seconds": int(time.time() - START_TIME),
        }
    )


async def api_status(_request):
    return JSONResponse(
        {
            "ok": True,
            "llm_endpoint": settings.llm_api_url,
            "total_scans": len(SCANS_STORE),
            "reports_dir": str(REPORTS_DIR),
        }
    )


def _public_settings() -> dict:
    """Settings safe for GET responses: selection + key flags, never bytes."""
    from .llm_providers import keys_configured

    return {
        "success": True,
        "llm_url": app_settings.get("llm_url", settings.llm_api_url),
        "llm_model": app_settings.get("llm_model", settings.llm_model),
        "llm_provider": app_settings.get("llm_provider", ""),
        "llm_api_key_set": any(keys_configured().values()),
        "keys_configured": keys_configured(),
        "target_mcp_url": app_settings.get("target_mcp_url", ""),
    }


async def get_settings(_request):
    # The API key is never returned -- only whether one is stored.
    return JSONResponse(_public_settings())


async def save_settings(request):
    body = await request.json()
    app_settings["llm_url"] = body.get("llm_url", app_settings.get("llm_url", settings.llm_api_url))
    app_settings["llm_model"] = body.get("llm_model", app_settings.get("llm_model", ""))
    app_settings["llm_provider"] = body.get("llm_provider", app_settings.get("llm_provider", ""))
    # Keys live in the keystore now; a key sent here is routed there.
    _sent_key = (body.get("llm_api_key") or "").strip()
    if _sent_key:
        from .llm_providers import save_key

        provider = (app_settings.get("llm_provider") or "").strip()
        if provider in ("openai", "anthropic", "azure"):
            save_key(provider, _sent_key)
    app_settings["target_mcp_url"] = body.get("target_mcp_url", app_settings.get("target_mcp_url", ""))
    save_app_settings(app_settings)
    return JSONResponse({"success": True, "settings": _public_settings()})


async def list_scans(_request):
    scans = [normalize_scan(s) for s in reversed(SCANS_STORE)]
    return JSONResponse({"success": True, "scans": scans, "total": len(scans)})


async def get_scan_detail(request):
    agent_name = request.path_params.get("agent_name")
    matches = [s for s in SCANS_STORE if s.get("agent_name") == agent_name]
    if not matches:
        return JSONResponse({"success": False, "error": f"No scan for '{agent_name}'"}, status_code=404)
    return JSONResponse({"success": True, "scan": normalize_scan(matches[-1])})


async def delete_scan_record(request):
    agent_name = request.path_params.get("agent_name")
    global SCANS_STORE
    kept, info = delete_scan(SCANS_STORE, agent_name)
    SCANS_STORE[:] = kept
    if not info["records_removed"]:
        return JSONResponse({"success": False, "error": f"No scan for '{agent_name}'"}, status_code=404)
    return JSONResponse({"success": True, "agent_name": agent_name, **info})


def _resolve_llm(details: dict) -> tuple[str, str, str, str]:
    """Resolve (url, model, provider, api_key) for judges and chat.

    Cloud vendors need no live detection: saved provider + model + key
    (keystore or vendor env var) is enough. Local vendors prefer live
    detection for the URL, saved settings for the model.
    """
    from .llm_providers import get_key
    from .scanner import is_cloud_vendor, pick_chat_model

    provider = (app_settings.get("llm_provider") or details.get("provider") or "local").strip() or "local"
    if provider in ("lm-studio", "ollama"):
        provider = "local"
    if is_cloud_vendor(provider):
        url = app_settings.get("llm_url", "")
        model = app_settings.get("llm_model", "")
        return url, model, provider, get_key(provider)
    url = details.get("url") or app_settings.get("llm_url") or settings.llm_api_url
    model = app_settings.get("llm_model") or pick_chat_model(details.get("models") or [])
    return url, model, "local", ""


async def _run_scan_job(job_id: str, mcp_url: str, agent_description: str, profiles: list[str]):
    job = JOBS[job_id]
    try:
        from .scanner import detect_llm_details, fetch_tools_from_mcp, run_giskard_scan

        job["status"] = "detecting-llm"
        details = await detect_llm_details()
        llm_url, llm_model, llm_provider, llm_key = _resolve_llm(details)
        if not llm_url or not llm_model:
            job.update(
                {
                    "status": "failed",
                    "error": "No LLM configured. Start LM Studio (:1234)/Ollama (:11434) or set a vendor model + key in Settings.",
                }
            )
            return

        job["status"] = "discovering-tools"
        try:
            tools = await fetch_tools_from_mcp(mcp_url)
        except Exception as e:
            msg = str(e)
            if not msg.startswith("Cannot open MCP session"):
                msg = f"Cannot list tools at {mcp_url}: {msg}"
            job.update({"status": "failed", "error": msg})
            return
        if not tools:
            job.update({"status": "failed", "error": f"Cannot list tools at {mcp_url}"})
            return

        agent_name = mcp_url.split("//")[-1].replace("/", "_").replace(":", "_")
        tool_names = ", ".join(t["name"] for t in tools)
        desc = agent_description or f"MCP server at {mcp_url} with tools: {tool_names}"

        job.update({"status": "scanning", "agent_name": agent_name, "tools": tool_names})
        # Blocking Giskard run goes to a worker thread so the loop stays alive.
        result = await asyncio.to_thread(
            run_giskard_scan, agent_name, desc, mcp_url, tools, profiles, llm_url, llm_model, llm_provider, llm_key
        )

        record = {
            "agent_name": agent_name,
            "target": mcp_url,
            "issues_found": result["has_issues"],
            "issue_count": result["issue_count"],
            "total_issues": result["issue_count"],
            "tools": tool_names,
            "tools_scanned": len(tools),
            "issues": result.get("issues", []),
            "profiles": result.get("profiles", profiles),
            "tags": result.get("tags", []),
            "llm_model": llm_model,
            "llm_provider": llm_provider,
            "report_path": result["report_path"],
            "timestamp": __import__("datetime").datetime.now().isoformat(),
        }
        upsert_record(SCANS_STORE, record)
        job.update({"status": "complete", "result": normalize_scan(record)})
    except asyncio.CancelledError:
        job.update({"status": "cancelled"})
        raise
    except Exception as e:
        job.update({"status": "failed", "error": str(e)})
    finally:
        job["finished"] = __import__("datetime").datetime.now().isoformat()
        _JOB_TASKS.pop(job_id, None)


async def trigger_scan(request):
    body = await request.json()
    mcp_url = (body.get("mcp_url") or "").strip()
    agent_description = body.get("agent_description", "")
    raw_profiles = body.get("profiles", "")
    if isinstance(raw_profiles, str):
        profiles = [p.strip() for p in raw_profiles.split(",") if p.strip()]
    elif isinstance(raw_profiles, list):
        profiles = [str(p).strip() for p in raw_profiles if str(p).strip()]
    else:
        profiles = []
    if not mcp_url:
        return JSONResponse({"success": False, "error": "mcp_url required"}, status_code=400)

    job_id = uuid.uuid4().hex[:12]
    JOBS[job_id] = {
        "job_id": job_id,
        "status": "queued",
        "target": mcp_url,
        "profiles": profiles,
        "created": __import__("datetime").datetime.now().isoformat(),
    }
    _JOB_TASKS[job_id] = asyncio.create_task(_run_scan_job(job_id, mcp_url, agent_description, profiles))
    return JSONResponse({"success": True, "job_id": job_id, "status": "queued"}, status_code=202)


async def list_jobs(_request):
    jobs = sorted(JOBS.values(), key=lambda j: j.get("created", ""), reverse=True)
    return JSONResponse({"success": True, "jobs": jobs, "total": len(jobs)})


async def get_job(request):
    job_id = request.path_params.get("job_id", "")
    job = JOBS.get(job_id)
    if not job:
        return JSONResponse({"success": False, "error": f"No job '{job_id}'"}, status_code=404)
    return JSONResponse({"success": True, "job": job})


async def cancel_job(request):
    job_id = request.path_params.get("job_id", "")
    job = JOBS.get(job_id)
    if not job:
        return JSONResponse({"success": False, "error": f"No job '{job_id}'"}, status_code=404)
    if job.get("status") in ("complete", "failed", "cancelled"):
        return JSONResponse({"success": True, "job": job})
    task = _JOB_TASKS.get(job_id)
    if task and not task.done():
        task.cancel()
        job["status"] = "cancelling"
    else:
        job["status"] = "cancelled"
    return JSONResponse({"success": True, "job": job})


async def discover_servers(_request):
    from .scanner import discover_servers as ds

    servers = await ds()
    return JSONResponse({"success": True, "servers": servers, "total": len(servers)})


async def detect_llm(_request):
    from .scanner import detect_llm_details as dl
    from .scanner import pick_chat_model

    details = await dl()
    url = details.get("url")
    models = details.get("models", [])
    saved_model = app_settings.get("llm_model", settings.llm_model)
    active_model = saved_model or pick_chat_model(models)
    return JSONResponse(
        {
            "success": url is not None,
            "url": url or "",
            "provider": details.get("provider", "none"),
            "model": active_model,
            "models": models,
            "endpoint_configured": settings.llm_api_url,
        }
    )


async def llm_models(request):
    """Model catalog for the active provider. Keys stay server-side.

    Query: ?provider= (defaults to saved) &url= (defaults to saved, for
    custom endpoints). Never returns any key.
    """
    from .scanner import list_provider_models

    provider = request.query_params.get("provider", "") or app_settings.get("llm_provider", "") or "local"
    url = request.query_params.get("url", "") or app_settings.get("llm_url", "")
    result = await list_provider_models(provider, url, app_settings.get("llm_api_key", ""))
    return JSONResponse(result)


async def list_reports(_request):
    if not REPORTS_DIR.is_dir():
        return JSONResponse({"success": True, "reports": []})
    files = sorted(REPORTS_DIR.iterdir(), key=os.path.getmtime, reverse=True)
    reports = [
        {"filename": f.name, "size": f.stat().st_size, "modified": time.ctime(f.stat().st_mtime)}
        for f in files
        if f.suffix == ".html"
    ]
    return JSONResponse({"success": True, "reports": reports})


async def serve_report(request):
    filename = request.path_params.get("filename", "")
    safe = Path(filename).name
    filepath = REPORTS_DIR / safe
    if not filepath.is_file() or filepath.suffix != ".html":
        return JSONResponse({"success": False, "error": "Report not found"}, status_code=404)
    return FileResponse(str(filepath), media_type="text/html")


async def report_summary(request):
    filename = request.path_params.get("filename", "")
    safe = Path(filename).name
    for scan in reversed(SCANS_STORE):
        if safe in scan.get("report_path", ""):
            return JSONResponse({"success": True, "scan": normalize_scan(scan)})
    return JSONResponse({"success": False, "error": "No matching scan"})


async def report_html_content(request):
    filename = request.path_params.get("filename", "")
    safe = Path(filename).name
    filepath = REPORTS_DIR / safe
    if not filepath.is_file() or filepath.suffix != ".html":
        return JSONResponse({"success": False, "error": "Report not found"}, status_code=404)
    html = filepath.read_text(encoding="utf-8")
    return JSONResponse({"success": True, "html": html, "filename": safe})


async def compare_reports(request):
    body = await request.json()
    filenames = body.get("filenames", [])
    scans = []
    for fname in filenames:
        safe = Path(fname).name
        for scan in SCANS_STORE:
            if safe in scan.get("report_path", ""):
                scans.append(normalize_scan(scan))
                break
    return JSONResponse({"success": True, "scans": scans})


async def delete_report_file(request):
    filename = request.path_params.get("filename", "")
    kept, info = delete_report(SCANS_STORE, filename)
    SCANS_STORE[:] = kept
    if not info["file_removed"] and not info["records_removed"]:
        return JSONResponse({"success": False, "error": "Report not found"}, status_code=404)
    return JSONResponse({"success": True, "filename": Path(filename).name, **info})


async def list_targets(_request):
    targets = load_targets()
    return JSONResponse({"success": True, "targets": targets, "total": len(targets)})


async def create_target(request):
    body = await request.json()
    targets, msg = add_target(body.get("url", ""), body.get("label", ""), body.get("description", ""))
    if targets is None:
        return JSONResponse({"success": False, "error": msg}, status_code=400)
    return JSONResponse({"success": True, "targets": targets, "total": len(targets), "message": msg})


async def delete_target(request):
    try:
        body = await request.json()
    except Exception:
        body = {}
    url = body.get("url", "") or request.query_params.get("url", "")
    if not url:
        return JSONResponse({"success": False, "error": "url required"}, status_code=400)
    targets, removed = remove_target(url)
    if not removed:
        return JSONResponse({"success": False, "error": "Target not saved"}, status_code=404)
    return JSONResponse({"success": True, "targets": targets, "total": len(targets)})


async def chat(request):
    """Chat completion proxy -- saved selection, keys stay server-side.

    Body: {"messages": [{role, content}...], "system": optional,
    "provider"?: override, "model"?: override, "endpoint"?: override}.
    """
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"success": False, "error": "messages required"}, status_code=400)
    messages = body.get("messages", [])
    if not messages:
        return JSONResponse({"success": False, "error": "messages required"}, status_code=400)
    system = (body.get("system") or "You help with Giskard adversarial scan results and LLM security analysis.").strip()
    from .llm_providers import chat_complete

    provider = (body.get("provider") or app_settings.get("llm_provider") or "").strip()
    model = (body.get("model") or app_settings.get("llm_model") or "").strip()
    endpoint = (body.get("endpoint") or app_settings.get("llm_url") or "").strip()
    if not provider or not model:
        return JSONResponse(
            {"success": False, "error": "No LLM configured. Set provider + model in Settings."}, status_code=400
        )
    full = [{"role": "system", "content": system}]
    full += [m for m in messages if isinstance(m, dict)][:20]
    from .llm_providers import chat_complete, explain_provider_error

    try:
        text = await chat_complete(provider, model, full, endpoint)
    except Exception as e:
        return JSONResponse(
            {"success": False, "error": explain_provider_error(str(e), provider, model)}, status_code=502
        )
    return JSONResponse({"success": True, "content": text or "(empty response)", "model": model, "provider": provider})


# ------------------------------------------------- standard /api/llm/* ---
# Fleet-standard LLM surface (WEBAPP_SOTA_STANDARDS section VI + pilot
# arxiv-mcp llm_providers.py). Legacy /api/v1/* routes below stay working.


async def llm_providers(_request):
    """Provider registry + live local detection. Never returns key bytes."""
    from .llm_providers import probe_all_locals, public_provider_info

    detected = await probe_all_locals()
    providers = public_provider_info()
    for p in providers:
        if p["kind"] == "local":
            info = detected.get(p["id"], {})
            p["detected"] = bool(info.get("reachable"))
            if info.get("models"):
                p["models"] = info["models"]
    return JSONResponse({"providers": providers})


async def llm_models_std(request):
    """Model catalog: ?provider=&endpoint=. {models, source: live|curated|none}."""
    from .llm_providers import list_models

    provider = request.query_params.get("provider", "").strip()
    endpoint = request.query_params.get("endpoint", "").strip()
    if not provider:
        return JSONResponse({"success": False, "error": "provider required"}, status_code=400)
    try:
        result = await list_models(provider, endpoint)
    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)[:200]}, status_code=400)
    return JSONResponse({"success": True, **result})


async def llm_chat(request):
    """Standard chat proxy: {provider, model, messages[], endpoint?}."""
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"success": False, "error": "messages required"}, status_code=400)
    provider = (body.get("provider") or "").strip()
    model = (body.get("model") or "").strip()
    messages = body.get("messages", [])
    endpoint = (body.get("endpoint") or "").strip()
    if not provider or not model or not messages:
        return JSONResponse({"success": False, "error": "provider, model, messages required"}, status_code=400)
    from .llm_providers import chat_complete, explain_provider_error

    try:
        text = await chat_complete(provider, model, messages, endpoint)
    except Exception as e:
        return JSONResponse(
            {"success": False, "error": explain_provider_error(str(e), provider, model)}, status_code=502
        )
    return JSONResponse({"success": True, "content": text})


async def llm_test(request):
    """Validate a provider without saving anything.

    Body: {"provider": id, "api_key"?: typed-but-unsaved key,
    "endpoint"?: custom/azure endpoint}. Returns {ok, models, source, note}.
    ok is True only for a live list -- curated names without a key are
    explicitly marked so the UI never reports them as a successful test.
    """
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"success": False, "error": "provider required"}, status_code=400)
    provider = (body.get("provider") or "").strip()
    if not provider:
        return JSONResponse({"success": False, "error": "provider required"}, status_code=400)
    from .llm_providers import get_provider, list_models

    if not get_provider(provider):
        return JSONResponse({"success": False, "error": f"Unknown provider '{provider}'"}, status_code=400)
    result = await list_models(provider, (body.get("endpoint") or "").strip(), (body.get("api_key") or ""))
    ok = result.get("source") == "live" and len(result.get("models", [])) > 0
    if provider == "azure":
        from .llm_providers import get_key as _get_key

        has_key = bool((body.get("api_key") or "").strip() or _get_key("azure"))
        ok = bool((body.get("endpoint") or "").strip()) and has_key
        result["note"] = "Endpoint + key present. Azure has no list API -- type the deployment name as model."
    return JSONResponse({"success": True, "ok": ok, **result})


async def llm_chat_stream(request):
    """SSE chat stream, OpenAI-style chunks + [DONE]. Falls back to 1 chunk."""
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"success": False, "error": "messages required"}, status_code=400)
    provider = (body.get("provider") or "").strip()
    model = (body.get("model") or "").strip()
    messages = body.get("messages", [])
    endpoint = (body.get("endpoint") or "").strip()
    if not provider or not model or not messages:
        return JSONResponse({"success": False, "error": "provider, model, messages required"}, status_code=400)
    from starlette.responses import StreamingResponse

    from .llm_providers import chat_stream

    return StreamingResponse(
        chat_stream(provider, model, messages, endpoint),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


async def settings_llm_get(_request):
    """Saved LLM selection + per-cloud key flags. Never returns key bytes."""
    from .llm_providers import keys_configured

    return JSONResponse(
        {
            "provider": app_settings.get("llm_provider", ""),
            "endpoint": app_settings.get("llm_url", ""),
            "model": app_settings.get("llm_model", ""),
            "keys_configured": keys_configured(),
        }
    )


async def settings_llm_post(request):
    """Save selection; write-only api_key goes to the keystore.

    Body: {provider?, endpoint?, model?, api_key?, select?}. Keys are
    always attached to `provider`. Selection (provider/endpoint/model)
    is only switched when select is not False -- so a key typed on a
    non-active card can be saved without hijacking the active pair.
    """
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"success": False, "error": "invalid JSON"}, status_code=400)
    from .llm_providers import get_provider, save_key

    provider = (body.get("provider") or "").strip()
    if provider and not get_provider(provider):
        return JSONResponse({"success": False, "error": f"Unknown provider '{provider}'"}, status_code=400)
    switch = body.get("select", True)
    if provider and switch:
        app_settings["llm_provider"] = provider
    if "endpoint" in body and switch:
        app_settings["llm_url"] = (body.get("endpoint") or "").strip()
    if "model" in body and switch:
        app_settings["llm_model"] = (body.get("model") or "").strip()
    key_saved = False
    api_key = (body.get("api_key") or "").strip()
    if api_key:
        if not provider:
            return JSONResponse({"success": False, "error": "provider required with api_key"}, status_code=400)
        try:
            save_key(provider, api_key)
            key_saved = True
        except Exception as e:
            return JSONResponse({"success": False, "error": str(e)[:200]}, status_code=400)
    save_app_settings(app_settings)
    from .llm_providers import keys_configured as _keys_configured

    return JSONResponse(
        {
            "success": True,
            "key_saved": key_saved,
            "settings": {
                "provider": app_settings.get("llm_provider", ""),
                "endpoint": app_settings.get("llm_url", ""),
                "model": app_settings.get("llm_model", ""),
                "keys_configured": _keys_configured(),
            },
        }
    )


async def settings_llm_key_delete(request):
    """Forget one stored cloud key: DELETE /api/settings/llm/key?provider=."""
    from .llm_providers import delete_key

    provider = request.query_params.get("provider", "").strip()
    if not provider:
        return JSONResponse({"success": False, "error": "provider required"}, status_code=400)
    try:
        removed = delete_key(provider)
    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)[:200]}, status_code=400)
    return JSONResponse({"success": True, "removed": removed})


async def llm_gpus(_request):
    """Live GPU VRAM ([] when no GPU/driver)."""
    from .llm_providers import gpu_vram

    gpus = await asyncio.to_thread(gpu_vram)
    return JSONResponse({"gpus": gpus})


async def llm_onboarding(_request):
    """Fresh-install facts: locals, configured clouds, recommended path."""
    from .llm_providers import onboarding_state

    return JSONResponse(onboarding_state())


async def list_tools(_request):
    try:
        tool_list = await mcp.list_tools()
        tools = []
        for t in tool_list:
            ann = getattr(t, "annotations", None)
            tools.append(
                {
                    "name": t.name,
                    "description": getattr(t, "description", ""),
                    "annotations": {
                        "readonly": getattr(ann, "readOnlyHint", None) or getattr(ann, "readonly", False),
                    }
                    if ann
                    else {},
                }
            )
        return JSONResponse({"success": True, "tools": tools, "total": len(tools)})
    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)


def _skill_name(uri: str) -> str:
    """'skill://giskard-redteam/SKILL.md' -> 'giskard-redteam'."""
    parts = [p for p in uri.split("/") if p and p != "SKILL.md"]
    for p in reversed(parts):
        if p not in ("skill:", "skill"):
            return p
    return uri


async def list_skills(_request):
    try:
        resources = await mcp.list_resources()
        skills = []
        for r in resources:
            uri = str(r.uri) if hasattr(r, "uri") else ""
            if "skill" in uri.lower():
                skills.append({"name": _skill_name(uri), "uri": uri})
        return JSONResponse({"success": True, "skills": skills})
    except Exception:
        return JSONResponse({"success": True, "skills": []})


async def get_skill(request):
    name = request.path_params.get("name", "")
    try:
        resources = await mcp.list_resources()
        for r in resources:
            uri = str(r.uri) if hasattr(r, "uri") else ""
            if "skill" in uri.lower() and (name in uri or _skill_name(uri) == name):
                content = await mcp.read_resource(uri)
                return JSONResponse({"success": True, "name": _skill_name(uri), "content": str(content)})
        return JSONResponse({"success": False, "error": "Skill not found"}, status_code=404)
    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)


async def diagnostics(_request):
    from .scanner import detect_llm as dl

    llm_url = await dl()
    return JSONResponse(
        {
            "ok": True,
            "service": "giskard-mcp",
            "version": "0.1.0",
            "uptime_seconds": int(time.time() - START_TIME),
            "port": BACKEND_PORT,
            "total_scans": len(SCANS_STORE),
            "reports_available": len(list(REPORTS_DIR.glob("*.html"))) if REPORTS_DIR.is_dir() else 0,
            "lm_studio_detected": llm_url is not None,
        }
    )


_frontend_dirs = [
    Path(__file__).resolve().parent.parent.parent / "webapp" / "frontend" / "dist",
    Path(__file__).resolve().parent.parent.parent / "webapp" / "frontend" / "out",
]
FRONTEND_DIST = None
for _d in _frontend_dirs:
    if _d.is_dir() and (_d / "index.html").exists():
        FRONTEND_DIST = str(_d.resolve())
        break


class SPAStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)
        if response.status_code == 404:
            response = await super().get_response("index.html", scope)
        return response


mcp_app = mcp.http_app(path="/")

routes = [
    Route("/", health),
    Route("/health", health),
    Route("/api/health", health),
    Route("/api/v1/health", health),
    Route("/api/v1/status", api_status),
    Route("/api/v1/settings", get_settings),
    Route("/api/v1/settings", save_settings, methods=["PUT"]),
    Route("/api/v1/scans", list_scans),
    Route("/api/v1/scans", trigger_scan, methods=["POST"]),
    Route("/api/v1/scans/{agent_name}", get_scan_detail),
    Route("/api/v1/scans/{agent_name}", delete_scan_record, methods=["DELETE"]),
    Route("/api/v1/jobs", list_jobs),
    Route("/api/v1/jobs/{job_id}", get_job),
    Route("/api/v1/jobs/{job_id}", cancel_job, methods=["DELETE"]),
    Route("/api/v1/discover", discover_servers),
    Route("/api/v1/detect-llm", detect_llm),
    Route("/api/v1/llm-models", llm_models),
    Route("/api/v1/targets", list_targets),
    Route("/api/v1/targets", create_target, methods=["POST"]),
    Route("/api/v1/targets", delete_target, methods=["DELETE"]),
    Route("/api/v1/reports", list_reports),
    Route("/api/v1/reports/compare", compare_reports, methods=["POST"]),
    Route("/api/v1/reports/{filename}", serve_report),
    Route("/api/v1/reports/{filename}", delete_report_file, methods=["DELETE"]),
    Route("/api/v1/reports/{filename}/summary", report_summary),
    Route("/api/v1/reports/{filename}/html", report_html_content),
    Route("/api/v1/tools", list_tools),
    Route("/api/v1/skills", list_skills),
    Route("/api/v1/skills/{name}", get_skill),
    Route("/api/v1/chat", chat, methods=["POST"]),
    Route("/api/llm/providers", llm_providers),
    Route("/api/llm/models", llm_models_std),
    Route("/api/llm/chat", llm_chat, methods=["POST"]),
    Route("/api/llm/chat/stream", llm_chat_stream, methods=["POST"]),
    Route("/api/llm/test", llm_test, methods=["POST"]),
    Route("/api/settings/llm", settings_llm_get),
    Route("/api/settings/llm", settings_llm_post, methods=["POST"]),
    Route("/api/settings/llm/key", settings_llm_key_delete, methods=["DELETE"]),
    Route("/api/llm/gpus", llm_gpus),
    Route("/api/llm/onboarding", llm_onboarding),
    Route("/api/v1/diagnostics", diagnostics),
    # Mount path is stripped by Starlette, so the inner app serves from "/".
    # (http_app(path="/mcp") here double-prefixes and 404s -- fleet standard
    # is mount "/mcp" + inner path "/", e.g. calibre-mcp.)
    Mount(f"/{settings.mcp_http_path.lstrip('/')}", app=mcp_app),
]

app = Starlette(routes=routes, lifespan=mcp_app.lifespan)
_tauri = os.environ.get("GISKARD_TAURI", "").lower() in ("1", "true", "yes")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:11056",
        "http://localhost:11056",
        "http://127.0.0.1:11057",
        "http://localhost:11057",
        "http://tauri.localhost",
        "https://tauri.localhost",
        "tauri://localhost",
    ],
    allow_origin_regex=r"https?://tauri\.localhost(:\d+)?" if _tauri else None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
