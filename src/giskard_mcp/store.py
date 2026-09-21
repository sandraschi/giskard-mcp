"""Disk-backed depot for scan records, HTML reports, and saved scan targets.

Scan history used to live only in ``SCANS_STORE`` (RAM) while report HTML
files lived on disk -- so every restart orphaned the reports. This module
persists the record list to ``scans_index.json`` inside the reports dir,
so records and files survive restarts together.

Targets (saved MCP URLs) live in ``targets.json`` next to the index.
All file writes are atomic (tmp + replace) and guarded by a lock.
"""

import json
import logging
import threading
from pathlib import Path
from urllib.parse import urlparse

from .config import settings

logger = logging.getLogger("giskardmcp.store")

_lock = threading.Lock()


def reports_dir() -> Path:
    d = Path(settings.local_reports_dir)
    d.mkdir(parents=True, exist_ok=True)
    return d


def _index_file() -> Path:
    return reports_dir() / "scans_index.json"


def _targets_file() -> Path:
    return reports_dir() / "targets.json"


def _read_json(path: Path, default):
    try:
        if path.is_file():
            return json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        logger.warning("Could not read %s: %s", path, e)
    return default


def _write_json(path: Path, data) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
    tmp.replace(path)


def normalize_scan(scan: dict) -> dict:
    """Add compat aliases so old and new frontends both work."""
    out = dict(scan)
    if "total_issues" not in out and "issue_count" in out:
        out["total_issues"] = out["issue_count"]
    if "issue_count" not in out and "total_issues" in out:
        out["issue_count"] = out["total_issues"]
    if "tools_scanned" not in out and "tools" in out:
        tools = out["tools"]
        out["tools_scanned"] = len(tools.split(",")) if isinstance(tools, str) else tools
    return out


def load_records() -> list[dict]:
    data = _read_json(_index_file(), [])
    records = [normalize_scan(r) for r in data if isinstance(r, dict)]
    logger.info("Loaded %d scan record(s) from %s", len(records), _index_file())
    return records


def save_records(records: list[dict]) -> None:
    with _lock:
        _write_json(_index_file(), records)


def upsert_record(records: list[dict], record: dict) -> list[dict]:
    """Replace any existing record for the agent, else append. Persists."""
    record = normalize_scan(record)
    records = [r for r in records if r.get("agent_name") != record.get("agent_name")]
    records.append(record)
    save_records(records)
    return records


def delete_scan(records: list[dict], agent_name: str) -> tuple[list[dict], dict]:
    """Drop scan record(s) for an agent and their orphaned report files."""
    victims = [r for r in records if r.get("agent_name") == agent_name]
    kept = [r for r in records if r.get("agent_name") != agent_name]
    files_removed: list[str] = []
    for v in victims:
        fname = Path(v.get("report_path", "")).name
        if not fname:
            continue
        still_ref = any(Path(r.get("report_path", "")).name == fname for r in kept)
        if not still_ref:
            try:
                target = reports_dir() / fname
                if target.is_file() and target.suffix == ".html":
                    target.unlink()
                    files_removed.append(fname)
            except Exception as e:
                logger.warning("Could not remove report %s: %s", fname, e)
    if len(kept) != len(records):
        save_records(kept)
    return kept, {"records_removed": len(victims), "files_removed": files_removed}


def delete_report(records: list[dict], filename: str) -> tuple[list[dict], dict]:
    """Remove a report HTML file and any scan records pointing at it."""
    safe = Path(filename).name
    target = reports_dir() / safe
    file_removed = False
    if target.is_file() and target.suffix == ".html":
        try:
            target.unlink()
            file_removed = True
        except Exception as e:
            logger.warning("Could not remove report %s: %s", safe, e)
    victims = [r for r in records if Path(r.get("report_path", "")).name == safe]
    kept = [r for r in records if Path(r.get("report_path", "")).name != safe]
    if victims:
        save_records(kept)
    return kept, {"file_removed": file_removed, "records_removed": len(victims)}


# ------------------------------------------------- app settings file ---
def app_settings_path() -> Path:
    return Path(__file__).resolve().parent / "app_settings.json"


def load_app_settings() -> dict:
    return _read_json(app_settings_path(), {})


def save_app_settings(data: dict) -> None:
    with _lock:
        _write_json(app_settings_path(), data)


# ---------------------------------------------------------------- targets ---
def _valid_target_url(url: str) -> bool:
    try:
        parts = urlparse(url.strip())
        return parts.scheme in ("http", "https") and bool(parts.hostname)
    except Exception:
        return False


def load_targets() -> list[dict]:
    data = _read_json(_targets_file(), [])
    return [t for t in data if isinstance(t, dict) and t.get("url")]


def save_targets(targets: list[dict]) -> None:
    with _lock:
        _write_json(_targets_file(), targets)


def add_target(url: str, label: str = "", description: str = "") -> tuple[list[dict] | None, str]:
    url = (url or "").strip()
    if not _valid_target_url(url):
        return None, "URL must be http(s), e.g. http://127.0.0.1:10702/mcp"
    targets = load_targets()
    if any(t.get("url") == url for t in targets):
        return targets, "Target already saved"
    targets.append({"url": url, "label": label.strip() or url, "description": description.strip()})
    save_targets(targets)
    return targets, "ok"


def remove_target(url: str) -> tuple[list[dict], bool]:
    targets = load_targets()
    kept = [t for t in targets if t.get("url") != url]
    if len(kept) != len(targets):
        save_targets(kept)
        return kept, True
    return targets, False
