import logging
import sys
import os
import asyncio
from pathlib import Path

from fastapi import FastAPI
from starlette.middleware.base import BaseHTTPMiddleware

def _add_shared_path() -> None:
    base = Path(__file__).resolve()
    candidates = [
        base.parent / "shared",
        base.parent.parent / "shared",
        base.parent.parent.parent / "shared",
        Path("/app/shared"),
    ]
    for candidate in candidates:
        candidate_str = str(candidate)
        if candidate.exists() and candidate_str not in sys.path:
            sys.path.insert(0, candidate_str)


# Configure JSON structured logging at startup
_add_shared_path()
try:
    from structured_logger import get_logger
    _log = get_logger("rag-service")
except ImportError:
    logging.basicConfig(level=logging.INFO)
    _log = None  # type: ignore

from model_config import env_first, env_provider
from interface.routers import router
from interface.auth import api_key_middleware

app = FastAPI(title="RAG Service", version="1.0.0")
app.add_middleware(BaseHTTPMiddleware, dispatch=api_key_middleware)
app.include_router(router)


@app.on_event("startup")
async def _startup():
    if _log:
        _log.info("RAG Service started")
    # Pre-warm Ollama only when the selected provider actually uses Ollama.
    import httpx
    _logger = logging.getLogger(__name__)
    ollama_url = env_first("OLLAMA_BASE_URL", default="http://ollama:11434")
    llm_provider = env_provider("LLM_PROVIDER", default="ollama")
    query_rewrite_provider = env_provider("QUERY_REWRITE_LLM_PROVIDER", "UTILITY_LLM_PROVIDER", default=llm_provider)
    hyde_provider = env_provider("HYDE_LLM_PROVIDER", "UTILITY_LLM_PROVIDER", default=query_rewrite_provider)
    query_decomposer_provider = env_provider("QUERY_DECOMPOSER_LLM_PROVIDER", "UTILITY_LLM_PROVIDER", default=query_rewrite_provider)
    query_seed_provider = env_provider("QUERY_SEED_LLM_PROVIDER", "GRAPH_QUERY_SEED_LLM_PROVIDER", "UTILITY_LLM_PROVIDER", default=llm_provider)
    compression_provider = env_provider("COMPRESSION_LLM_PROVIDER", default=llm_provider)
    embedding_provider = env_provider("EMBEDDING_PROVIDER", default="ollama")
    _fallback_llm = env_first("LLM_MODEL", "OLLAMA_LLM_MODEL", default="qwen3:0.6b")
    query_rewrite_model = env_first("QUERY_REWRITE_LLM_MODEL", "UTILITY_LLM_MODEL", "LLM_MODEL", "OLLAMA_LLM_MODEL", default=_fallback_llm)
    hyde_model = env_first("HYDE_LLM_MODEL", "QUERY_REWRITE_LLM_MODEL", "UTILITY_LLM_MODEL", "LLM_MODEL", "OLLAMA_LLM_MODEL", default=_fallback_llm)
    query_decomposer_model = env_first("QUERY_DECOMPOSER_LLM_MODEL", "UTILITY_LLM_MODEL", "QUERY_REWRITE_LLM_MODEL", "LLM_MODEL", "OLLAMA_LLM_MODEL", default=_fallback_llm)
    query_seed_model = env_first("QUERY_SEED_LLM_MODEL", "GRAPH_QUERY_SEED_LLM_MODEL", "QUERY_REWRITE_LLM_MODEL", "UTILITY_LLM_MODEL", "LLM_MODEL", "OLLAMA_LLM_MODEL", default=_fallback_llm)
    compression_model = env_first("COMPRESSION_LLM_MODEL", "QUERY_REWRITE_LLM_MODEL", "LLM_MODEL", "OLLAMA_LLM_MODEL", default=_fallback_llm)
    embed_model = env_first("EMBEDDING_MODEL", "OLLAMA_EMBEDDING_MODEL", default="bge-m3")

    async def _warm_ollama():
        if llm_provider != "ollama" and embedding_provider != "ollama":
            _logger.info(
                "Skipping Ollama pre-warm (llm_provider=%s, embedding_provider=%s)",
                llm_provider,
                embedding_provider,
            )
            return
        try:
            timeout = httpx.Timeout(connect=5.0, read=20.0, write=20.0, pool=5.0)
            async with httpx.AsyncClient(timeout=timeout) as client:
                # Warm embed model first, then LLM(s) (sequential to avoid Ollama eviction)
                if embedding_provider == "ollama":
                    await client.post(
                        f"{ollama_url}/api/embed",
                        json={"model": embed_model, "input": "warmup", "keep_alive": -1},
                    )
                    _logger.info("Ollama embed model '%s' pre-warmed", embed_model)
                llm_stages = [
                    ("query rewrite", query_rewrite_provider, query_rewrite_model),
                    ("HyDE", hyde_provider, hyde_model),
                    ("query decomposer", query_decomposer_provider, query_decomposer_model),
                    ("query seed", query_seed_provider, query_seed_model),
                    ("compression", compression_provider, compression_model),
                ]
                for stage_name, provider, model in llm_stages:
                    if provider != "ollama":
                        continue
                    response = await client.post(
                        f"{ollama_url}/api/chat",
                        json={
                            "model": model,
                            "messages": [{"role": "user", "content": "hi"}],
                            "stream": False,
                            "keep_alive": -1,
                            "options": {"num_predict": 1, "num_ctx": 512},
                        },
                    )
                    response.raise_for_status()
                    _logger.info("Ollama %s LLM model '%s' pre-warmed", stage_name, model)
        except Exception as exc:
            _logger.warning("Ollama pre-warm failed (non-fatal): %s", exc)

    asyncio.create_task(_warm_ollama())
