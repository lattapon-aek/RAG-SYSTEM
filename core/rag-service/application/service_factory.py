"""
ServiceFactory - instantiate all RAG components from config dict/env vars
"""
import os
import sys
from pathlib import Path
from typing import Any, Dict, Optional

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

from application.ports.i_embedding_service import IEmbeddingService
from application.ports.i_vector_store import IVectorStore
from application.ports.i_llm_service import ILLMService
from application.ports.i_reranker import IReranker
from application.ports.i_context_builder import IContextBuilder
from application.ports.i_context_compressor import IContextCompressor
from application.ports.i_semantic_cache import ISemanticCache
from application.context_builder import ContextBuilder
from application.context_compressor import NoOpCompressor, ExtractiveCompressor, LLMCompressor
from application.query_use_case import QueryUseCase
from application.routing_policy import RoutingPolicy
from model_config import build_model_config
from provider_factory import create_embedding_service, create_chat_llm_service


def _stage_llm_cfg(
    runtime: Dict[str, Any],
    provider_key: str,
    model_key: str,
    *,
    provider_fallback_keys: tuple[str, ...] = (),
    model_fallback_keys: tuple[str, ...] = (),
) -> Dict[str, Any]:
    provider_candidates = (provider_key, *provider_fallback_keys, "llm_provider")
    model_candidates = (model_key, *model_fallback_keys, "llm_model")
    provider = next((runtime[key] for key in provider_candidates if runtime.get(key)), runtime.get("llm_provider", "ollama"))
    model = next((runtime[key] for key in model_candidates if runtime.get(key)), runtime.get("llm_model", "qwen3:0.6b"))
    return {
        **runtime,
        "llm_provider": provider,
        "llm_model": model,
    }


class EmbeddingFactory:
    @staticmethod
    def create(cfg: Dict[str, Any]) -> IEmbeddingService:
        runtime = {**build_model_config(), **cfg}
        return create_embedding_service(
            provider=runtime.get("embedding_provider", "ollama"),
            model=runtime.get("embedding_model", "bge-m3"),
            ollama_base_url=runtime.get("ollama_base_url", "http://ollama:11434"),
            openai_api_key=runtime.get("openai_api_key", ""),
            cohere_api_key=runtime.get("cohere_api_key", ""),
            cohere_input_type=runtime.get("cohere_input_type", "search_document"),
            hf_device=runtime.get("hf_device", "cpu"),
        )


class VectorStoreFactory:
    @staticmethod
    def create(cfg: Dict[str, Any]) -> IVectorStore:
        provider = cfg.get("vector_store", os.getenv("VECTOR_STORE", "chromadb"))
        if provider == "chromadb":
            from infrastructure.adapters.chromadb_vector_store import ChromaDBVectorStore
            return ChromaDBVectorStore(
                host=cfg.get("chromadb_host", os.getenv("CHROMADB_HOST", "chromadb")),
                port=int(cfg.get("chromadb_port", os.getenv("CHROMADB_PORT", "8000"))),
                collection_prefix=cfg.get(
                    "chroma_collection_prefix",
                    os.getenv("CHROMA_COLLECTION_PREFIX", "rag_1024"),
                ),
            )
        raise ValueError(f"Unknown vector store provider: {provider}")


class LLMFactory:
    @staticmethod
    def create(cfg: Dict[str, Any]) -> ILLMService:
        runtime = {**build_model_config(), **cfg}
        return create_chat_llm_service(
            provider=runtime.get("llm_provider", "ollama"),
            model=runtime.get("llm_model", "qwen3:0.6b"),
            ollama_base_url=runtime.get("ollama_base_url", "http://ollama:11434"),
            openai_api_key=runtime.get("openai_api_key", ""),
            typhoon_api_key=runtime.get("typhoon_api_key", ""),
            typhoon_base_url=runtime.get("typhoon_base_url", "https://api.opentyphoon.ai/v1"),
            anthropic_api_key=runtime.get("anthropic_api_key", ""),
            azure_api_key=runtime.get("azure_api_key", ""),
            azure_endpoint=runtime.get("azure_endpoint", ""),
            azure_deployment=runtime.get("azure_deployment", ""),
        )


class RerankerFactory:
    @staticmethod
    def create(cfg: Dict[str, Any]) -> IReranker:
        provider = cfg.get("reranker", os.getenv("RERANKER", "service"))
        if provider == "noop":
            from infrastructure.adapters.reranker_client import NoOpReranker
            return NoOpReranker()
        from infrastructure.adapters.reranker_client import RerankerServiceClient
        return RerankerServiceClient(
            base_url=cfg.get("reranker_url",
                             os.getenv("RERANKER_SERVICE_URL", "http://reranker-service:8005"))
        )


class CompressorFactory:
    @staticmethod
    def create(cfg: Dict[str, Any], llm: Optional[ILLMService] = None,
               compression_threshold: float = 0.1,
               system_prompt: str = "") -> IContextCompressor:
        strategy = cfg.get("compressor", os.getenv("COMPRESSOR", "noop"))
        if strategy == "extractive":
            return ExtractiveCompressor(threshold=compression_threshold)
        if strategy == "llm" and llm:
            return LLMCompressor(llm=llm, system_prompt=system_prompt)
        return NoOpCompressor()


class RAGServiceFactory:
    @staticmethod
    def from_config(cfg: Optional[Dict[str, Any]] = None) -> QueryUseCase:
        cfg = cfg or {}
        runtime = {**build_model_config(), **cfg}

        policy = RoutingPolicy.from_env()

        embedding = EmbeddingFactory.create(runtime)
        vector_store = VectorStoreFactory.create(runtime)

        # Stage-specific LLMs
        query_rewrite_llm = LLMFactory.create(_stage_llm_cfg(
            runtime,
            "query_rewrite_llm_provider",
            "query_rewrite_llm_model",
            provider_fallback_keys=("utility_llm_provider",),
            model_fallback_keys=("utility_llm_model",),
        ))
        hyde_llm = LLMFactory.create(_stage_llm_cfg(
            runtime,
            "hyde_llm_provider",
            "hyde_llm_model",
            provider_fallback_keys=("query_rewrite_llm_provider", "utility_llm_provider"),
            model_fallback_keys=("query_rewrite_llm_model", "utility_llm_model"),
        ))
        query_decomposer_llm = LLMFactory.create(_stage_llm_cfg(
            runtime,
            "query_decomposer_llm_provider",
            "query_decomposer_llm_model",
            provider_fallback_keys=("query_rewrite_llm_provider", "utility_llm_provider"),
            model_fallback_keys=("query_rewrite_llm_model", "utility_llm_model"),
        ))
        query_seed_llm = LLMFactory.create(_stage_llm_cfg(
            runtime,
            "query_seed_llm_provider",
            "query_seed_llm_model",
            provider_fallback_keys=("utility_llm_provider",),
            model_fallback_keys=("utility_llm_model",),
        ))
        compression_llm = LLMFactory.create(_stage_llm_cfg(
            runtime,
            "compression_llm_provider",
            "compression_llm_model",
            provider_fallback_keys=("llm_provider",),
            model_fallback_keys=("llm_model",),
        ))

        reranker = RerankerFactory.create(cfg)
        ctx_builder = ContextBuilder(
            overlap_threshold=policy.context_dedup_overlap_threshold
        )
        compressor = CompressorFactory.create(
            runtime,
            compression_llm,
            compression_threshold=policy.context_compression_threshold,
            system_prompt=runtime.get("compression_llm_system_prompt", ""),
        )

        # Optional: semantic cache
        cache = None
        if cfg.get("enable_cache", os.getenv("ENABLE_CACHE", "true").lower() == "true"):
            try:
                from infrastructure.adapters.redis_semantic_cache import RedisSemanticCache
                cache = RedisSemanticCache(
                    redis_url=cfg.get("redis_url", os.getenv("REDIS_URL", "redis://redis:6379/0")),
                    threshold=policy.semantic_cache_threshold,
                )
            except Exception:
                pass  # Cache is non-fatal

        # Optional: memory
        memory = None
        if cfg.get("enable_memory", os.getenv("ENABLE_MEMORY", "false").lower() == "true"):
            backend = cfg.get("memory_backend", os.getenv("MEMORY_BACKEND", "composite")).lower()
            try:
                if backend == "postgres":
                    from infrastructure.adapters.memory_service import PostgresMemoryAdapter
                    memory = PostgresMemoryAdapter(
                        dsn=cfg.get("postgres_dsn", os.getenv("POSTGRES_URL", ""))
                    )
                elif backend == "redis":
                    from infrastructure.adapters.memory_service import RedisMemoryAdapter
                    memory = RedisMemoryAdapter(
                        redis_url=cfg.get("redis_memory_url",
                                          os.getenv("REDIS_URL", "redis://redis:6379/1"))
                    )
                else:  # composite (default)
                    from infrastructure.adapters.memory_service import (
                        RedisMemoryAdapter, PostgresMemoryAdapter, CompositeMemoryAdapter,
                    )
                    short = RedisMemoryAdapter(
                        redis_url=cfg.get("redis_memory_url",
                                          os.getenv("REDIS_URL", "redis://redis:6379/1"))
                    )
                    long = PostgresMemoryAdapter(
                        dsn=cfg.get("postgres_dsn", os.getenv("POSTGRES_URL", ""))
                    )
                    memory = CompositeMemoryAdapter(short=short, long=long)
            except Exception:
                pass

        # Optional: graph service
        graph = None
        if cfg.get("enable_graph", os.getenv("ENABLE_GRAPH", "true").lower() == "true"):
            try:
                from infrastructure.adapters.graph_service_client import GraphServiceClient
                graph = GraphServiceClient(
                    base_url=cfg.get("graph_service_url",
                                     os.getenv("GRAPH_SERVICE_URL", "http://graph-service:8002"))
                )
            except Exception:
                pass

        # Stub document repository (real impl uses PostgreSQL)
        from infrastructure.adapters.postgres_document_repository import PostgresDocumentRepository
        doc_repo = PostgresDocumentRepository(
            dsn=cfg.get("postgres_dsn", os.getenv("POSTGRES_DSN", ""))
        )

        # Query intelligence: rewriter, HyDE, decomposer — use utility LLM (speed over quality)
        from infrastructure.adapters.query_intelligence import (
            LLMQueryRewriter, HyDEGenerator, QueryDecomposer,
        )
        query_rewriter = LLMQueryRewriter(llm=query_rewrite_llm)
        hyde_generator = HyDEGenerator(llm=hyde_llm)
        query_decomposer = QueryDecomposer(llm=query_decomposer_llm)

        # Optional: Redis client for token quota
        redis_client = None
        try:
            import redis.asyncio as aioredis
            redis_url = cfg.get("redis_url", os.getenv("REDIS_URL", "redis://redis:6379/0"))
            redis_client = aioredis.from_url(redis_url, decode_responses=True)
        except Exception:
            pass

        return QueryUseCase(
            embedding_service=embedding,
            vector_store=vector_store,
            llm_service=None,
            document_repository=doc_repo,
            reranker=reranker,
            context_builder=ctx_builder,
            context_compressor=compressor,
            semantic_cache=cache,
            memory_service=memory,
            graph_service=graph,
            query_seed_llm=query_seed_llm,
            query_rewriter=query_rewriter,
            hyde_generator=hyde_generator,
            query_decomposer=query_decomposer,
            redis_client=redis_client,
            routing_policy=policy,
        )
