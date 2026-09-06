"""Starlette HTTP app with REST API for the Giskard MCP webapp."""

import os
import time
from pathlib import Path

from starlette.applications import Starlette
from starlette.middleware.cors import CORSMiddleware
from starlette.responses import FileResponse, JSONResponse
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles

from .config import settings
from .server import SCANS_STORE, mcp

BACKEND_PORT = settings.port
FRONTEND_PORT = BACKEND_PORT + 1
REPORTS_DIR = Path(settings.local_reports_dir)
START_TIME = time.time()

# In-memory settings store (persisted to JSON file)
SETTINGS_FILE = Path(__file__).resolve().parent / "app_settings.json"
_loaded_settings: dict = {}


def _load_persisted_settings() -> dict:
    if SETTINGS_FILE.exists():
        try:
            import json

            return json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def _save_persisted_settings(data: dict):
    import json

    SETTINGS_FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")


app_settings = _load_persisted_settings()


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


async def get_settings(_request):
    return JSONResponse(
        {
            "success": True,
            "llm_url": app_settings.get("llm_url", settings.llm_api_url),
            "llm_model": app_settings.get("llm_model", ""),
            "target_mcp_url": app_settings.get("target_mcp_url", ""),
        }
    )


async def save_settings(request):
    body = await request.json()
    app_settings["llm_url"] = body.get("llm_url", app_settings.get("llm_url", settings.llm_api_url))
    app_settings["llm_model"] = body.get("llm_model", app_settings.get("llm_model", ""))
    app_settings["target_mcp_url"] = body.get("target_mcp_url", app_settings.get("target_mcp_url", ""))
    _save_persisted_settings(app_settings)
    return JSONResponse({"success": True, "settings": app_settings})


async def list_scans(_request):
    scans = list(reversed(SCANS_STORE))
    return JSONResponse({"success": True, "scans": scans, "total": len(scans)})


async def get_scan_detail(request):
    agent_name = request.path_params.get("agent_name")
    matches = [s for s in SCANS_STORE if s.get("agent_name") == agent_name]
    if not matches:
        return JSONResponse({"success": False, "error": f"No scan for '{agent_name}'"}, status_code=404)
    return JSONResponse({"success": True, "scan": matches[-1]})


async def trigger_scan(request):
    body = await request.json()
    mcp_url = body.get("mcp_url", "")
    agent_description = body.get("agent_description", "")
    if not mcp_url:
        return JSONResponse({"success": False, "error": "mcp_url required"}, status_code=400)

    from .scanner import detect_llm, fetch_tools_from_mcp, run_giskard_scan

    await detect_llm()
    tools = await fetch_tools_from_mcp(mcp_url)
    if not tools:
        return JSONResponse({"success": False, "error": f"Cannot list tools at {mcp_url}"})

    agent_name = mcp_url.split("//")[-1].replace("/", "_").replace(":", "_")
    desc = agent_description or f"MCP server at {mcp_url}"
    try:
        result = run_giskard_scan(agent_name, desc, mcp_url, tools)
        SCANS_STORE.append(
            {
                "agent_name": agent_name,
                "target": mcp_url,
                "issues_found": result["has_issues"],
                "issue_count": result["issue_count"],
                "report_path": result["report_path"],
                "timestamp": __import__("datetime").datetime.now().isoformat(),
            }
        )
        return JSONResponse({"success": True, **result})
    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)


async def discover_servers(_request):
    from .scanner import discover_servers as ds

    servers = await ds()
    return JSONResponse({"success": True, "servers": servers, "total": len(servers)})


async def detect_llm(_request):
    from .scanner import detect_llm as dl

    url = await dl()
    return JSONResponse(
        {
            "success": url is not None,
            "url": url or "",
            "endpoint_configured": settings.llm_api_url,
        }
    )


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
            return JSONResponse({"success": True, "scan": scan})
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
                scans.append(scan)
                break
    return JSONResponse({"success": True, "scans": scans})


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


async def list_skills(_request):
    try:
        resources = await mcp.list_resources()
        skills = []
        for r in resources:
            uri = str(r.uri) if hasattr(r, "uri") else ""
            if "skill" in uri.lower():
                skills.append({"name": uri.split("/")[-1].replace("SKILL.md", "").strip("/"), "uri": uri})
        return JSONResponse({"success": True, "skills": skills})
    except Exception:
        return JSONResponse({"success": True, "skills": []})


async def get_skill(request):
    name = request.path_params.get("name", "")
    try:
        resources = await mcp.list_resources()
        for r in resources:
            uri = str(r.uri) if hasattr(r, "uri") else ""
            if name in uri and "skill" in uri.lower():
                content = await mcp.read_resource(uri)
                return JSONResponse({"success": True, "name": name, "content": str(content)})
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


routes = [
    Route("/", health),
    Route("/health", health),
    Route("/api/health", health),
    Route("/api/v1/status", api_status),
    Route("/api/v1/settings", get_settings),
    Route("/api/v1/settings", save_settings, methods=["PUT"]),
    Route("/api/v1/scans", list_scans),
    Route("/api/v1/scans/{agent_name}", get_scan_detail),
    Route("/api/v1/scans", trigger_scan, methods=["POST"]),
    Route("/api/v1/discover", discover_servers),
    Route("/api/v1/detect-llm", detect_llm),
    Route("/api/v1/reports", list_reports),
    Route("/api/v1/reports/{filename}", serve_report),
    Route("/api/v1/reports/{filename}/summary", report_summary),
    Route("/api/v1/reports/{filename}/html", report_html_content),
    Route("/api/v1/reports/compare", compare_reports, methods=["POST"]),
    Route("/api/v1/tools", list_tools),
    Route("/api/v1/skills", list_skills),
    Route("/api/v1/skills/{name}", get_skill),
    Route("/api/v1/diagnostics", diagnostics),
    Mount(f"/{settings.mcp_http_path.lstrip('/')}", app=mcp.http_app(path=settings.mcp_http_path)),
]

app = Starlette(routes=routes)
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
