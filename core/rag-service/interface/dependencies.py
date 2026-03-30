"""
FastAPI dependency injection for RAG Service
"""
import os
import sys
from functools import lru_cache
from pathlib import Path
from typing import Optional

def _add_shared_path() -> None:
    base = Path(__file__).resolve()
    candidates = [
        base.parent.parent / "shared",
        base.parent.parent.parent / "shared",
        base.parent.parent.parent.parent / "shared",
        Path("/app/shared"),
    ]
    for candidate in candidates:
        candidate_str = str(candidate)
        if candidate.exists() and candidate_str not in sys.path:
            sys.path.insert(0, candidate_str)


_add_shared_path()

try:
    from application.service_factory import RAGServiceFactory
    from application.query_use_case import QueryUseCase
except ImportError:
    from ..application.service_factory import RAGServiceFactory
    from ..application.query_use_case import QueryUseCase

from model_config import build_model_config


@lru_cache(maxsize=1)
def _get_config() -> dict:
    model_cfg = build_model_config()
    return {
        **model_cfg,
        "vector_store": os.getenv("VECTOR_STORE", "chromadb"),
        "reranker": os.getenv("RERANKER", "service"),
        "compressor": os.getenv("COMPRESSOR", "noop"),
        "enable_cache": os.getenv("ENABLE_CACHE", "true").lower() == "true",
        "enable_memory": os.getenv("ENABLE_MEMORY", "false").lower() == "true",
        "enable_graph": os.getenv("ENABLE_GRAPH", "true").lower() == "true",
        "postgres_dsn": os.getenv("POSTGRES_DSN", os.getenv("POSTGRES_URL", "")),
        "redis_url": os.getenv("REDIS_URL", "redis://redis:6379/0"),
        "chromadb_host": os.getenv("CHROMADB_HOST", "chromadb"),
        "graph_service_url": os.getenv("GRAPH_SERVICE_URL", "http://graph-service:8002"),
        "reranker_url": os.getenv("RERANKER_SERVICE_URL", "http://reranker-service:8005"),
        "knowledge_connector_url": os.getenv("KNOWLEDGE_CONNECTOR_URL", "http://knowledge-connector:8006"),
    }


@lru_cache(maxsize=1)
def _get_use_case() -> QueryUseCase:
    return RAGServiceFactory.from_config(_get_config())


async def get_query_use_case() -> QueryUseCase:
    return _get_use_case()


async def get_doc_repo():
    return _get_use_case()._doc_repo


async def get_memory_service():
    return _get_use_case()._memory
