"""
FastAPI dependency injection — wires up IngestDocumentUseCase with real adapters.
"""
import logging
import os
import sys
from pathlib import Path
from typing import List, Optional, Tuple

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
    from application.ingest_document_use_case import IngestDocumentUseCase, IngestRequest
    from application.ports.i_chunker import IChunker
    from application.ports.i_document_parser import IDocumentParser
    from application.ports.i_document_repository import IDocumentRepository
    from application.ports.i_embedding_service import IEmbeddingService
    from application.ports.i_graph_service_client import IGraphServiceClient
    from application.ports.i_vector_store import IVectorStore
    from domain.entities import Chunk, ChunkWithEmbedding, Document
    from infrastructure.adapters.parser_factory import ParserFactory
    from infrastructure.adapters.chunker_factory import ChunkerFactory
    from infrastructure.adapters.chromadb_vector_store import ChromaDBVectorStore
    from infrastructure.adapters.postgres_document_repository import PostgresDocumentRepository
    from infrastructure.adapters.graph_service_client import GraphServiceHttpClient
    from infrastructure.adapters.document_version_repository import DocumentVersionRepository
    from model_config import build_model_config
    from provider_factory import create_embedding_service
except ImportError:
    from ..application.ingest_document_use_case import IngestDocumentUseCase, IngestRequest
    from ..application.ports.i_chunker import IChunker
    from ..application.ports.i_document_parser import IDocumentParser
    from ..application.ports.i_document_repository import IDocumentRepository
    from ..application.ports.i_embedding_service import IEmbeddingService
    from ..application.ports.i_graph_service_client import IGraphServiceClient
    from ..application.ports.i_vector_store import IVectorStore
    from ..domain.entities import Chunk, ChunkWithEmbedding, Document
    from ..infrastructure.adapters.parser_factory import ParserFactory
    from ..infrastructure.adapters.chunker_factory import ChunkerFactory
    from ..infrastructure.adapters.chromadb_vector_store import ChromaDBVectorStore
    from ..infrastructure.adapters.postgres_document_repository import PostgresDocumentRepository
    from ..infrastructure.adapters.graph_service_client import GraphServiceHttpClient
    from ..infrastructure.adapters.document_version_repository import DocumentVersionRepository
    from model_config import build_model_config
    from provider_factory import create_embedding_service

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Job queue singleton (set by main.py on startup)
# ---------------------------------------------------------------------------

_job_queue = None


def set_job_queue(queue) -> None:
    global _job_queue
    _job_queue = queue


def get_job_queue():
    if _job_queue is None:
        raise RuntimeError("Job queue not initialized")
    return _job_queue


def get_doc_repo() -> IDocumentRepository:
    """FastAPI dependency that returns a configured document repository."""
    postgres_url = os.getenv("POSTGRES_URL", "postgresql://localhost/rag")
    return PostgresDocumentRepository(postgres_url=postgres_url)


def get_vector_store():
    """FastAPI dependency that returns a configured vector store."""
    chroma_url = os.getenv("CHROMA_URL", "http://chromadb:8000")
    chroma_prefix = os.getenv("CHROMA_COLLECTION_PREFIX", "rag_1024")
    return ChromaDBVectorStore(base_url=chroma_url, collection_prefix=chroma_prefix)


def get_ingest_use_case() -> IngestDocumentUseCase:
    """FastAPI dependency that returns a configured IngestDocumentUseCase."""
    chroma_url = os.getenv("CHROMA_URL", "http://chromadb:8000")
    postgres_url = os.getenv("POSTGRES_URL", "postgresql://localhost/rag")
    graph_service_url = os.getenv("GRAPH_SERVICE_URL", "http://graph-service:8002")
    graph_service_timeout = float(os.getenv("GRAPH_SERVICE_TIMEOUT_SECONDS", "180"))
    model_cfg = build_model_config()
    chunker_strategy = os.getenv("CHUNKER_STRATEGY", "fixed")
    embedding_service = create_embedding_service(
        provider=model_cfg["embedding_provider"],
        model=model_cfg["embedding_model"],
        ollama_base_url=model_cfg["ollama_base_url"],
        openai_api_key=model_cfg["openai_api_key"],
        cohere_api_key=model_cfg["cohere_api_key"],
        cohere_input_type=model_cfg["cohere_input_type"],
        hf_device=model_cfg["hf_device"],
    )
    chunker_kwargs = {}
    if chunker_strategy == "semantic":
        chunker_kwargs["embed_batch_fn"] = embedding_service.embed_batch
        chunker_kwargs["max_tokens"] = int(os.getenv("SEMANTIC_CHUNK_MAX_TOKENS", "256"))
        chunker_kwargs["similarity_threshold"] = float(
            os.getenv("SEMANTIC_CHUNK_SIMILARITY_THRESHOLD", "0.65")
        )

    logger.debug(
        "Config: chroma=%s postgres=%s graph=%s embedding_provider=%s model=%s",
        chroma_url, postgres_url, graph_service_url, model_cfg["embedding_provider"], model_cfg["embedding_model"],
    )

    return IngestDocumentUseCase(
        parser=ParserFactory.create(),
        chunker=ChunkerFactory.create(chunker_strategy, **chunker_kwargs),
        embedding_service=embedding_service,
        vector_store=ChromaDBVectorStore(
            base_url=chroma_url,
            collection_prefix=os.getenv("CHROMA_COLLECTION_PREFIX", "rag_1024"),
        ),
        document_repository=PostgresDocumentRepository(postgres_url=postgres_url),
        graph_service_client=GraphServiceHttpClient(
            base_url=graph_service_url,
            timeout=graph_service_timeout,
        ),
        version_repository=DocumentVersionRepository(postgres_url=postgres_url),
    )


def get_version_repo() -> DocumentVersionRepository:
    postgres_url = os.getenv("POSTGRES_URL", "postgresql://localhost/rag")
    return DocumentVersionRepository(postgres_url=postgres_url)
