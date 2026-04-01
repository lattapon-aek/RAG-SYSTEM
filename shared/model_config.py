"""Shared environment helpers for provider-neutral model config."""
from __future__ import annotations

import os


def env_first(*keys: str, default: str = "") -> str:
    """Return the first non-empty env var value from the provided keys."""
    for key in keys:
        value = os.getenv(key)
        if value is not None and value != "":
            return value
    return default


def env_provider(*keys: str, default: str = "ollama") -> str:
    return env_first(*keys, default=default).strip().lower()


def default_llm_model(provider: str) -> str:
    provider = provider.strip().lower()
    if provider == "openai":
        return "gpt-4o-mini"
    if provider == "anthropic":
        return "claude-3-haiku-20240307"
    if provider in {"typhoon", "opentyphoon"}:
        return env_first("TYPHOON_MODEL", default="typhoon-v2.1-12b-instruct")
    if provider == "azure":
        return env_first("AZURE_OPENAI_DEPLOYMENT", "LLM_MODEL", "OLLAMA_LLM_MODEL", default="gpt-4o-mini")
    return "qwen3:0.6b"


def default_embedding_model(provider: str) -> str:
    provider = provider.strip().lower()
    if provider == "openai":
        return "text-embedding-ada-002"
    if provider == "huggingface":
        return "sentence-transformers/all-MiniLM-L6-v2"
    if provider == "cohere":
        return "embed-english-v3.0"
    return "bge-m3"


def default_azure_deployment() -> str:
    return env_first("AZURE_OPENAI_DEPLOYMENT", "LLM_MODEL", "OLLAMA_LLM_MODEL", default="")


def default_typhoon_base_url() -> str:
    return env_first("TYPHOON_BASE_URL", default="https://api.opentyphoon.ai/v1")


def stage_provider(*keys: str, default: str) -> str:
    return env_provider(*keys, default=default)


def stage_model(*keys: str, default: str) -> str:
    return env_first(*keys, default=default)


def build_model_config() -> dict[str, str]:
    """Return canonical + legacy-compatible model env values."""
    llm_provider = env_provider("LLM_PROVIDER", default="ollama")
    query_rewrite_llm_provider = stage_provider("QUERY_REWRITE_LLM_PROVIDER", "UTILITY_LLM_PROVIDER", default=llm_provider)
    hyde_llm_provider = stage_provider("HYDE_LLM_PROVIDER", "UTILITY_LLM_PROVIDER", default=query_rewrite_llm_provider)
    query_decomposer_llm_provider = stage_provider("QUERY_DECOMPOSER_LLM_PROVIDER", "UTILITY_LLM_PROVIDER", default=query_rewrite_llm_provider)
    query_seed_llm_provider = stage_provider("QUERY_SEED_LLM_PROVIDER", "GRAPH_QUERY_SEED_LLM_PROVIDER", "UTILITY_LLM_PROVIDER", default=llm_provider)
    compression_llm_provider = stage_provider("COMPRESSION_LLM_PROVIDER", default=llm_provider)
    graph_llm_provider = stage_provider("GRAPH_LLM_PROVIDER", default=query_seed_llm_provider)
    gap_draft_llm_provider = stage_provider("GAP_DRAFT_LLM_PROVIDER", default=llm_provider)
    embedding_provider = env_provider("EMBEDDING_PROVIDER", default="ollama")
    llm_model_default = default_llm_model(llm_provider)
    query_rewrite_llm_model_default = default_llm_model(query_rewrite_llm_provider)
    hyde_llm_model_default = default_llm_model(hyde_llm_provider)
    query_decomposer_llm_model_default = default_llm_model(query_decomposer_llm_provider)
    query_seed_llm_model_default = default_llm_model(query_seed_llm_provider)
    compression_llm_model_default = default_llm_model(compression_llm_provider)
    graph_llm_model_default = default_llm_model(graph_llm_provider)
    gap_draft_llm_model_default = default_llm_model(gap_draft_llm_provider)
    embedding_model_default = default_embedding_model(embedding_provider)
    return {
        "llm_provider": llm_provider,
        "utility_llm_provider": query_rewrite_llm_provider,  # legacy alias
        "query_rewrite_llm_provider": query_rewrite_llm_provider,
        "hyde_llm_provider": hyde_llm_provider,
        "query_decomposer_llm_provider": query_decomposer_llm_provider,
        "query_seed_llm_provider": query_seed_llm_provider,
        "graph_llm_provider": graph_llm_provider,
        "gap_draft_llm_provider": gap_draft_llm_provider,
        "compression_llm_provider": compression_llm_provider,
        "embedding_provider": embedding_provider,
        "llm_model": stage_model("LLM_MODEL", "OLLAMA_LLM_MODEL", default=llm_model_default),
        "utility_llm_model": stage_model(
            "QUERY_REWRITE_LLM_MODEL",
            "UTILITY_LLM_MODEL",
            "LLM_MODEL",
            "OLLAMA_LLM_MODEL",
            default=query_rewrite_llm_model_default,
        ),  # legacy alias
        "query_rewrite_llm_model": stage_model(
            "QUERY_REWRITE_LLM_MODEL",
            "UTILITY_LLM_MODEL",
            "LLM_MODEL",
            "OLLAMA_LLM_MODEL",
            default=query_rewrite_llm_model_default,
        ),
        "hyde_llm_model": stage_model(
            "HYDE_LLM_MODEL",
            "QUERY_REWRITE_LLM_MODEL",
            "UTILITY_LLM_MODEL",
            "LLM_MODEL",
            "OLLAMA_LLM_MODEL",
            default=hyde_llm_model_default,
        ),
        "query_decomposer_llm_model": stage_model(
            "QUERY_DECOMPOSER_LLM_MODEL",
            "UTILITY_LLM_MODEL",
            "QUERY_REWRITE_LLM_MODEL",
            "LLM_MODEL",
            "OLLAMA_LLM_MODEL",
            default=query_decomposer_llm_model_default,
        ),
        "query_seed_llm_model": stage_model(
            "QUERY_SEED_LLM_MODEL",
            "GRAPH_QUERY_SEED_LLM_MODEL",
            "QUERY_REWRITE_LLM_MODEL",
            "UTILITY_LLM_MODEL",
            "LLM_MODEL",
            "OLLAMA_LLM_MODEL",
            default=query_seed_llm_model_default,
        ),
        "compression_llm_model": stage_model(
            "COMPRESSION_LLM_MODEL",
            "LLM_MODEL",
            "OLLAMA_LLM_MODEL",
            default=compression_llm_model_default,
        ),
        "graph_llm_model": stage_model(
            "GRAPH_LLM_MODEL",
            "QUERY_SEED_LLM_MODEL",
            "UTILITY_LLM_MODEL",
            "LLM_MODEL",
            "OLLAMA_LLM_MODEL",
            default=graph_llm_model_default,
        ),
        "gap_draft_llm_model": stage_model(
            "GAP_DRAFT_LLM_MODEL",
            "LLM_MODEL",
            "OLLAMA_LLM_MODEL",
            default=gap_draft_llm_model_default,
        ),
        "compression_llm_system_prompt": env_first("COMPRESSION_LLM_SYSTEM_PROMPT", default=""),
        "embedding_model": env_first("EMBEDDING_MODEL", "OLLAMA_EMBEDDING_MODEL", default=embedding_model_default),
        "ollama_base_url": env_first("OLLAMA_BASE_URL", default="http://ollama:11434"),
        "openai_api_key": env_first("OPENAI_API_KEY", default=""),
        "typhoon_api_key": env_first("TYPHOON_API_KEY", "OPENAI_API_KEY", default=""),
        "typhoon_base_url": env_first("TYPHOON_BASE_URL", default="https://api.opentyphoon.ai/v1"),
        "anthropic_api_key": env_first("ANTHROPIC_API_KEY", default=""),
        "azure_api_key": env_first("AZURE_OPENAI_API_KEY", default=""),
        "azure_endpoint": env_first("AZURE_OPENAI_ENDPOINT", default=""),
        "azure_deployment": default_azure_deployment(),
        "hf_device": env_first("HF_DEVICE", default="cpu"),
        "cohere_api_key": env_first("COHERE_API_KEY", default=""),
        "cohere_input_type": env_first("COHERE_INPUT_TYPE", default="search_document"),
    }
