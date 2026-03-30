"""Central provider factory used by all services."""
from __future__ import annotations

import sys
from pathlib import Path

from model_config import (
    build_model_config,
    env_first,
    env_provider,
    default_llm_model,
    default_embedding_model,
    default_azure_deployment,
    stage_provider,
    stage_model,
)


def _ensure_rag_service_path() -> None:
    repo_root = Path(__file__).resolve().parent.parent
    rag_service_root = repo_root / "core" / "rag-service"
    rag_service_root_str = str(rag_service_root)
    if rag_service_root_str not in sys.path:
        sys.path.insert(0, rag_service_root_str)


def create_embedding_service(
    *,
    provider: str,
    model: str,
    ollama_base_url: str,
    openai_api_key: str = "",
    cohere_api_key: str = "",
    cohere_input_type: str = "search_document",
    hf_device: str = "cpu",
):
    _ensure_rag_service_path()
    provider = provider.lower().strip()

    if provider == "openai":
        from infrastructure.adapters.openai_embedding_service import OpenAIEmbeddingService

        return OpenAIEmbeddingService(
            api_key=openai_api_key,
            model=model,
        )

    if provider == "huggingface":
        from infrastructure.adapters.huggingface_embedding_service import HuggingFaceEmbeddingService

        return HuggingFaceEmbeddingService(
            model=model,
            device=hf_device,
        )

    if provider == "cohere":
        from infrastructure.adapters.cohere_embedding_service import CohereEmbeddingService

        return CohereEmbeddingService(
            api_key=cohere_api_key,
            model=model,
            input_type=cohere_input_type,
        )

    from infrastructure.adapters.ollama_embedding_service import OllamaEmbeddingService

    return OllamaEmbeddingService(
        base_url=ollama_base_url,
        model=model,
    )


def create_chat_llm_service(
    *,
    provider: str,
    model: str,
    ollama_base_url: str,
    openai_api_key: str = "",
    typhoon_api_key: str = "",
    typhoon_base_url: str = "https://api.opentyphoon.ai/v1",
    anthropic_api_key: str = "",
    azure_api_key: str = "",
    azure_endpoint: str = "",
    azure_deployment: str = "",
):
    _ensure_rag_service_path()
    provider = provider.lower().strip()
    from shared.llm_services import (
        AnthropicLLMService,
        AzureOpenAILLMService,
        OllamaLLMService,
        OpenAILLMService,
    )

    if provider == "openai":
        return OpenAILLMService(
            api_key=openai_api_key,
            model=model,
        )

    if provider in {"typhoon", "opentyphoon"}:
        return OpenAILLMService(
            api_key=typhoon_api_key or openai_api_key,
            model=model,
            base_url=typhoon_base_url,
        )

    if provider == "anthropic":
        return AnthropicLLMService(
            api_key=anthropic_api_key,
            model=model,
        )

    if provider == "azure":
        return AzureOpenAILLMService(
            api_key=azure_api_key,
            endpoint=azure_endpoint,
            deployment=azure_deployment or model,
        )

    return OllamaLLMService(
        base_url=ollama_base_url,
        model=model,
    )
