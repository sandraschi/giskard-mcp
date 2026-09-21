"""Depot tests (isolated tmp dirs) + offline REST contract tests."""

import json

import pytest
from httpx import ASGITransport, AsyncClient

from giskard_mcp import store
from giskard_mcp.config import settings


@pytest.fixture
def depot(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "reports_dir", str(tmp_path))
    return tmp_path


def test_normalize_scan_aliases():
    out = store.normalize_scan({"issue_count": 3, "tools": "a, b"})
    assert out["total_issues"] == 3
    assert out["tools_scanned"] == 2
    out2 = store.normalize_scan({"total_issues": 1})
    assert out2["issue_count"] == 1


def test_record_roundtrip_and_replace(depot):
    recs = store.load_records()
    assert recs == []
    recs = store.upsert_record(recs, {"agent_name": "a", "issue_count": 1, "report_path": "x.html"})
    recs = store.upsert_record(recs, {"agent_name": "a", "issue_count": 5, "report_path": "x.html"})
    assert len(store.load_records()) == 1
    assert store.load_records()[0]["total_issues"] == 5
    assert (depot / "scans_index.json").is_file()


def test_delete_scan_removes_file_and_record(depot):
    rep = depot / "gone.html"
    rep.write_text("<html></html>", encoding="utf-8")
    recs = [{"agent_name": "g", "report_path": str(rep)}]
    store.save_records(recs)
    kept, info = store.delete_scan(recs, "g")
    assert kept == [] and info["records_removed"] == 1
    assert info["files_removed"] == ["gone.html"]
    assert not rep.exists()


def test_delete_report_missing_is_honest(depot):
    kept, info = store.delete_report([], "nope.html")
    assert kept == [] and info == {"file_removed": False, "records_removed": 0}


def test_targets_crud(depot):
    assert store.add_target("notaurl") == (None, "URL must be http(s), e.g. http://127.0.0.1:10702/mcp")
    targets, msg = store.add_target("http://127.0.0.1:10702/mcp", "t")
    assert msg == "ok" and len(targets) == 1
    assert (depot / "targets.json").is_file()
    same, msg2 = store.add_target("http://127.0.0.1:10702/mcp")
    assert msg2 == "Target already saved" and len(same) == 1
    kept, removed = store.remove_target("http://127.0.0.1:10702/mcp")
    assert removed and kept == []
    _kept2, removed2 = store.remove_target("http://127.0.0.1:10702/mcp")
    assert removed2 is False


def test_app_settings_roundtrip(depot, monkeypatch):
    monkeypatch.setattr(store, "app_settings_path", lambda: depot / "app_settings.json")
    store.save_app_settings({"a": 1})
    assert store.load_app_settings() == {"a": 1}


@pytest.fixture
def client():
    import giskard_mcp.app as appmod

    return AsyncClient(transport=ASGITransport(app=appmod.app), base_url="http://test")


async def test_settings_never_leak_keys(client, monkeypatch):
    import giskard_mcp.app as appmod

    monkeypatch.setenv("OPENAI_API_KEY", "SECRET")
    monkeypatch.setattr(appmod, "app_settings", {"llm_url": "u"})
    r = await client.get("/api/v1/settings")
    body = r.json()
    assert r.status_code == 200
    assert body["llm_api_key_set"] is True
    assert body["keys_configured"]["openai"] is True
    assert "SECRET" not in json.dumps(body)


async def test_settings_put_routes_key_to_keystore(client, monkeypatch, tmp_path):
    import giskard_mcp.app as appmod
    import giskard_mcp.llm_providers as llm

    monkeypatch.setattr(llm, "keystore_path", lambda: tmp_path / "llm_keys.json")
    monkeypatch.setattr(appmod, "app_settings", {"llm_provider": "openai"})
    monkeypatch.setattr(appmod, "save_app_settings", lambda _d: None)
    r = await client.put("/api/v1/settings", json={"llm_provider": "openai", "llm_api_key": "sk-test"})
    assert r.status_code == 200
    assert llm.get_key("openai") == "sk-test"
    assert "sk-test" not in json.dumps(r.json())


async def test_scans_and_jobs_validation(client):
    r = await client.post("/api/v1/scans", json={})
    assert r.status_code == 400
    r = await client.get("/api/v1/jobs/nope")
    assert r.status_code == 404
    r = await client.request("DELETE", "/api/v1/scans/nope")
    assert r.status_code == 404
    r = await client.request("DELETE", "/api/v1/reports/nope.html")
    assert r.status_code == 404
    r = await client.get("/api/v1/scans")
    assert r.status_code == 200 and "scans" in r.json()


async def test_chat_rejects_empty(client):
    r = await client.post("/api/v1/chat", json={"messages": []})
    assert r.status_code == 400


async def test_skills_surface(client):
    r = await client.get("/api/v1/skills")
    assert r.status_code == 200
    names = [s["name"] for s in r.json()["skills"]]
    assert "giskard-redteam" in names
    r = await client.get("/api/v1/skills/giskard-redteam")
    assert r.status_code == 200 and "Giskard" in r.json()["content"]
    r = await client.get("/api/v1/skills/nope")
    assert r.status_code == 404
