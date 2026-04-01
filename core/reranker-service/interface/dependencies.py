"""
Reranker Service — FastAPI dependency injection.
Selects backend based on RERANKER_BACKEND env var.
"""
import logging
import os
from functools import lru_cache

from application.ports import IRerankerModel
from application.rerank_use_case import RerankCandidatesUseCase

logger = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def _get_model() -> IRerankerModel:
    backend = os.getenv("RERANKER_BACKEND", "llm").lower()
    device = os.getenv("RERANKER_DEVICE", "cpu")

    if backend == "cohere":
        from infrastructure.cohere_reranker import CohereRerankAdapter
        api_key = os.getenv("COHERE_API_KEY", "")
        model = os.getenv("COHERE_RERANK_MODEL", "rerank-english-v3.0")
        logger.info("Using Cohere reranker: %s", model)
        return CohereRerankAdapter(api_key=api_key, model=model)

    if backend == "ms-marco":
        from infrastructure.ms_marco_reranker import MsMarcoCrossEncoder
        model_name = os.getenv("RERANKER_MODEL", "cross-encoder/ms-marco-MiniLM-L-6-v2")
        logger.info("Using MS-MARCO reranker: %s on %s", model_name, device)
        return MsMarcoCrossEncoder(model_name=model_name, device=device)

    if backend == "llm":
        from infrastructure.llm_reranker import LLMRerankerModel
        llm_url = os.getenv("LLM_RERANKER_URL", os.getenv("TYPHOON_BASE_URL", os.getenv("OLLAMA_BASE_URL", "http://ollama:11434")))
        llm_model = os.getenv("LLM_RERANKER_MODEL", os.getenv("TYPHOON_MODEL", os.getenv("OLLAMA_LLM_MODEL", "qwen3:0.6b")))
        llm_api_key = os.getenv("LLM_RERANKER_API_KEY", os.getenv("TYPHOON_API_KEY", os.getenv("OPENAI_API_KEY", "")))
        max_cands = int(os.getenv("LLM_RERANKER_MAX_CANDIDATES", "8"))
        logger.info("Using LLM reranker: %s @ %s", llm_model, llm_url)
        return LLMRerankerModel(base_url=llm_url, model=llm_model, max_candidates=max_cands, api_key=llm_api_key)

    if backend == "noop":
        from infrastructure.noop_reranker import NoOpReranker
        logger.info("Using NoOp reranker (pass-through)")
        return NoOpReranker()

    # Default: LLM
    from infrastructure.llm_reranker import LLMRerankerModel
    llm_url = os.getenv("LLM_RERANKER_URL", os.getenv("TYPHOON_BASE_URL", os.getenv("OLLAMA_BASE_URL", "http://ollama:11434")))
    llm_model = os.getenv("LLM_RERANKER_MODEL", os.getenv("TYPHOON_MODEL", os.getenv("OLLAMA_LLM_MODEL", "qwen3:0.6b")))
    llm_api_key = os.getenv("LLM_RERANKER_API_KEY", os.getenv("TYPHOON_API_KEY", os.getenv("OPENAI_API_KEY", "")))
    max_cands = int(os.getenv("LLM_RERANKER_MAX_CANDIDATES", "8"))
    logger.info("Using default LLM reranker: %s @ %s", llm_model, llm_url)
    return LLMRerankerModel(base_url=llm_url, model=llm_model, max_candidates=max_cands, api_key=llm_api_key)


@lru_cache(maxsize=1)
def _get_use_case() -> RerankCandidatesUseCase:
    return RerankCandidatesUseCase(model=_get_model())


def get_rerank_use_case() -> RerankCandidatesUseCase:
    return _get_use_case()


def get_model() -> IRerankerModel:
    return _get_model()
