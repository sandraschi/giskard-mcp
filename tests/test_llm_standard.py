"""Fleet-standard LLM surface tests. Keystore isolated to tmp dirs."""

import pytest
from httpx import ASGITransport, AsyncClient

import giskard_mcp.llm_providers as llm


@pytest.fixture(autouse=True)
def _keystore(tmp_path, monkeypatch):
    monkeypatch.setattr(llm, "keystore_path", lambda: tmp_path / "llm_keys.json")
    for var in ("OPENAI_API_KEY", "ANTHROPIC_API_KEY", "AZURE_API_KEY"):
        monkeypatch.delenv(var, raising=False)


def test_registry_ids():
    ids = [r["id"] for r in llm.PROVIDERS]
    assert ids == ["ollama", "lmstudio", "vllm", "openai", "anthropic", "azure"]
    assert llm.require_provider("ollama")["kind"] == "local"
    with pytest.raises(llm.LLMProviderError):
        llm.require_provider("nope")


def test_local_base_urls_avoid_localhost():
    # localhost:1234 404s on this box (IPv6). Registry must use 127.0.0.1.
    for r in llm.PROVIDERS:
        if r["kind"] == "local":
            assert "localhost" not in r["base_url"], r["id"]


def test_keystore_env_wins_and_roundtrips(monkeypatch):
    assert llm.get_key("openai") == ""
    llm.save_key("openai", "sk-store")
    assert llm.get_key("openai") == "sk-store"
    assert llm.is_configured("openai") is True
    assert llm.keys_configured()["openai"] is True
    monkeypatch.setenv("OPENAI_API_KEY", "sk-env")
    assert llm.get_key("openai") == "sk-env"
    assert llm.delete_key("openai") is True
    assert llm.delete_key("openai") is False
    with pytest.raises(llm.LLMProviderError):
        llm.save_key("ollama", "x")


def test_public_info_never_has_keys(monkeypatch):
    import json

    llm.save_key("anthropic", "SECRET-XYZ")
    monkeypatch.setenv("OPENAI_API_KEY", "SECRET-ABC")
    assert "SECRET" not in json.dumps(llm.public_provider_info())


async def test_list_models_curated_without_key():
    result = await llm.list_models("openai")
    assert result["source"] == "curated" and "gpt-4o-mini" in result["models"]
    result = await llm.list_models("azure")
    assert result["source"] == "none" and result["models"] == []


async def test_chat_complete_validates():
    with pytest.raises(llm.LLMProviderError):
        await llm.chat_complete("openai", "gpt-4o-mini", [{"role": "user", "content": "hi"}])
    with pytest.raises(llm.LLMProviderError):
        await llm.chat_complete("ollama", "", [{"role": "user", "content": "hi"}])


def test_onboarding_shape():
    state = llm.onboarding_state()
    assert [loc["id"] for loc in state["locals"]] == ["ollama", "lmstudio", "vllm"]
    assert "recommendation" in state and "clouds_configured" in state


def test_explain_provider_error_maps_to_instructions():
    msg = llm.explain_provider_error("litellm.BadRequestError: No models loaded. Use 'lms load'.", "lmstudio", "m7b")
    assert "no model loaded" in msg and "m7b" in msg
    msg = llm.explain_provider_error("Incorrect API key provided", "openai", "gpt-4o-mini")
    assert "key" in msg.lower()
    msg = llm.explain_provider_error("Connection refused", "ollama", "")
    assert "Start" in msg
    msg = llm.explain_provider_error("", "vllm", "")
    assert msg


@pytest.fixture
def client():
    import giskard_mcp.app as appmod

    return AsyncClient(transport=ASGITransport(app=appmod.app), base_url="http://test")


async def test_standard_providers_shape(client):
    r = await client.get("/api/llm/providers", timeout=30)
    assert r.status_code == 200
    providers = r.json()["providers"]
    by_id = {p["id"]: p for p in providers}
    assert set(by_id) == {"ollama", "lmstudio", "vllm", "openai", "anthropic", "azure"}
    for p in providers:
        for field in ("id", "label", "kind", "base_url", "needs_key", "key_env", "configured"):
            assert field in p, (p["id"], field)


async def test_standard_models_validation(client):
    r = await client.get("/api/llm/models", timeout=15)
    assert r.status_code == 400
    r = await client.get("/api/llm/models", params={"provider": "openai"}, timeout=20)
    body = r.json()
    assert body["source"] == "curated" and body["models"]


async def test_standard_settings_roundtrip(client, monkeypatch):
    import giskard_mcp.app as appmod

    monkeypatch.setattr(appmod, "app_settings", {})
    monkeypatch.setattr(appmod, "save_app_settings", lambda _d: None)
    r = await client.post(
        "/api/settings/llm",
        json={"provider": "anthropic", "model": "claude-sonnet-4-0", "api_key": "sk-t"},
        timeout=15,
    )
    assert r.status_code == 200 and r.json()["key_saved"] is True
    r = await client.get("/api/settings/llm", timeout=15)
    body = r.json()
    assert body["provider"] == "anthropic" and body["model"] == "claude-sonnet-4-0"
    assert body["keys_configured"]["anthropic"] is True
    assert "sk-t" not in r.text
    r = await client.request("DELETE", "/api/settings/llm/key?provider=anthropic", timeout=15)
    assert r.json()["removed"] is True
    r = await client.get("/api/settings/llm", timeout=15)
    assert r.json()["keys_configured"]["anthropic"] is False


async def test_key_save_without_switching_selection(client, monkeypatch):
    import giskard_mcp.app as appmod

    monkeypatch.setattr(appmod, "app_settings", {"llm_provider": "lmstudio", "llm_model": "m7b"})
    monkeypatch.setattr(appmod, "save_app_settings", lambda _d: None)
    r = await client.post(
        "/api/settings/llm",
        json={"provider": "anthropic", "model": "x", "api_key": "sk-t2", "select": False},
        timeout=15,
    )
    assert r.status_code == 200 and r.json()["key_saved"] is True
    r = await client.get("/api/settings/llm", timeout=15)
    body = r.json()
    assert body["provider"] == "lmstudio" and body["model"] == "m7b"
    assert body["keys_configured"]["anthropic"] is True


async def test_standard_chat_validation(client):
    r = await client.post("/api/llm/chat", json={"provider": "openai"}, timeout=15)
    assert r.status_code == 400
    r = await client.post("/api/llm/chat", json={"provider": "nope", "model": "m", "messages": []}, timeout=15)
    assert r.status_code == 400


async def test_llm_test_endpoint_honest_without_key(client):
    r = await client.post("/api/llm/test", json={"provider": "openai"}, timeout=20)
    body = r.json()
    assert r.status_code == 200
    assert body["ok"] is False
    assert body["source"] == "curated"
    assert body.get("key_missing") is True
    r = await client.post("/api/llm/test", json={"provider": "nope"}, timeout=15)
    assert r.status_code == 400
    r = await client.post("/api/llm/test", json={}, timeout=15)
    assert r.status_code == 400


async def test_list_models_override_key_not_persisted():
    result = await llm.list_models("openai", "", "sk-typed-not-saved")
    assert result["source"] in ("live", "curated")
    assert llm.get_key("openai") == ""


async def test_gpus_and_onboarding_shape(client):
    r = await client.get("/api/llm/gpus", timeout=30)
    assert r.status_code == 200 and "gpus" in r.json()
    r = await client.get("/api/llm/onboarding", timeout=15)
    assert "locals" in r.json() and "recommendation" in r.json()
