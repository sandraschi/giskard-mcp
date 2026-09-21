"""Pure-logic tests for scanner helpers. No network, no LLM calls."""

import pytest

from giskard_mcp.scanner import (
    SCAN_PROFILES,
    LLMConfigError,
    _prompt_param,
    build_litellm_params,
    configure_giskard_llm,
    pick_chat_model,
    resolve_scan_tags,
)


def test_profiles_cover_documented_names():
    for name in ("prompt_injection", "information_disclosure", "harmful_content", "role_play"):
        assert SCAN_PROFILES[name], name


def test_resolve_scan_tags_list():
    tags = resolve_scan_tags(["prompt_injection", "information_disclosure"])
    assert tags is not None
    assert "prompt_injection" in tags and "jailbreak" in tags
    assert "information_disclosure" in tags and "data_leakage" in tags


def test_resolve_scan_tags_string_and_empty():
    assert resolve_scan_tags("role_play, boundary_testing") == [
        "jailbreak",
        "robustness",
        "control_chars_injection",
        "text_perturbation",
    ]
    assert resolve_scan_tags([]) is None
    assert resolve_scan_tags(None) is None
    assert resolve_scan_tags(["nope"]) is None


def test_pick_chat_model_skips_embeddings():
    assert pick_chat_model(["x-embed-v1", "qwen3-8b", "gemma"]) == "qwen3-8b"
    assert pick_chat_model(["only-embed"]) == "only-embed"
    assert pick_chat_model([]) == ""


def _tools():
    return [
        {"name": "a", "schema_dict": {"properties": {"q": {"type": "string"}, "n": {"type": "integer"}}}},
        {"name": "b", "schema_dict": {}},
        {"name": "c", "schema_dict": {"properties": {"prompt": {"type": "string"}}}},
    ]


def test_prompt_param_prefers_text_fields():
    tools = _tools()
    assert _prompt_param(tools, "a") == "q"
    assert _prompt_param(tools, "b") == "prompt"
    assert _prompt_param(tools, "c") == "prompt"
    assert _prompt_param(tools, "missing") == "prompt"


def test_build_litellm_params_all_vendors():
    name, params = build_litellm_params("http://127.0.0.1:1234/v1", "qwen3-8b", "lm-studio", "")
    assert name == "openai/qwen3-8b"
    assert params["api_base"] == "http://127.0.0.1:1234/v1"

    name, params = build_litellm_params("", "gpt-4o-mini", "openai", "sk-x")
    assert name == "gpt-4o-mini" and params["api_key"] == "sk-x"

    name, params = build_litellm_params("", "claude-sonnet-4-0", "anthropic", "sk-a")
    assert name == "anthropic/claude-sonnet-4-0"

    name, params = build_litellm_params("https://x.openai.azure.com", "dep1", "azure", "k")
    assert name == "azure/dep1" and params["api_version"]


def test_build_litellm_params_missing_pieces_raise():
    with pytest.raises(LLMConfigError):
        build_litellm_params("", "m", "openai", "")
    with pytest.raises(LLMConfigError):
        build_litellm_params("", "", "local", "")


def test_configure_giskard_llm_needs_both():
    assert configure_giskard_llm("", "")["configured"] is False


def test_configure_giskard_llm_local_offline():
    # set_llm_model only sets globals -- no network involved.
    result = configure_giskard_llm("http://127.0.0.1:1234/v1", "test-model-xyz", "local", "")
    assert result["configured"] is True
    assert result["model"] == "openai/test-model-xyz"
