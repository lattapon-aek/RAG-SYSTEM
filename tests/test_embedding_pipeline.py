"""
Task 5.3 — Property tests: Embedding dimension consistency
Task 5.14 — Property tests: Citation completeness & Cache idempotency

Usage:
    cd rag-system
    py -3.12 -m pytest tests/test_embedding_pipeline.py -v
    (run separately from test_chunkers.py to avoid domain collision)
"""
import sys
import os
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

_RAG = os.path.abspath(os.path.join(os.path.dirname(__file__), "../core/rag-service"))
_INGESTION = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "../ingestion/ingestion-service")
)
sys.path = [p for p in sys.path if p != _INGESTION]
if _RAG not in sys.path:
    sys.path.insert(0, _RAG)

from application.query_use_case import QueryUseCase, QueryRequest
from application.context_builder import ContextBuilder
from application.context_compressor import NoOpCompressor
from domain.entities import RerankedResult


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_reranked(chunk_id: str, text: str, doc_id: str = "doc-1", score: float = 0.9):
    return RerankedResult(
        chunk_id=chunk_id, document_id=doc_id, text=text,
        score=score, original_rank=0, reranked_rank=0,
    )


def _make_use_case(llm=None, vector_store=None, embed=None, reranker=None, cache=None):
    embedding_svc = embed or AsyncMock()
    if embed is None:
        embedding_svc.embed = AsyncMock(return_value=[0.1] * 8)

    vs = vector_store or AsyncMock()
    if vector_store is None:
        vs.search = AsyncMock(return_value=[])

    llm_svc = llm or AsyncMock()
    if llm is None:
        llm_svc.generate = AsyncMock(return_value="mocked answer")

    dr = AsyncMock()
    dr.list_all = AsyncMock(return_value=[])
    dr.find_by_id = AsyncMock(return_value=None)
    dr.delete = AsyncMock()

    rr = reranker or AsyncMock()
    if reranker is None:
        rr.rerank = AsyncMock(return_value=[])

    return QueryUseCase(
        embedding_service=embedding_svc,
        vector_store=vs,
        llm_service=llm_svc,
        document_repository=dr,
        reranker=rr,
        context_builder=ContextBuilder(),
        context_compressor=NoOpCompressor(),
        semantic_cache=cache,
    )


# ===========================================================================
# Task 5.3 — Property: Embedding dimension consistency
# ===========================================================================

class TestEmbeddingDimensionConsistency:
    """Property 4: ทุก embedding จาก model เดียวกันต้องมี dimension เท่ากันเสมอ"""

    @pytest.mark.asyncio
    async def test_ollama_embed_consistent_dimension(self):
        """OllamaEmbeddingService.embed() returns same-length vectors for different inputs."""
        from infrastructure.adapters.ollama_embedding_service import OllamaEmbeddingService

        fake_dim = 768
        fake_embedding = [0.1] * fake_dim

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_resp = AsyncMock()
            mock_resp.raise_for_status = MagicMock()
            mock_resp.json = MagicMock(return_value={"embeddings": [fake_embedding]})

            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client.post = AsyncMock(return_value=mock_resp)
            mock_client_cls.return_value = mock_client

            svc = OllamaEmbeddingService(base_url="http://localhost:11434")

            texts = [
                "Hello world",
                "A much longer document about retrieval-augmented generation systems",
                "x",
            ]
            embeddings = []
            for text in texts:
                emb = await svc.embed(text)
                embeddings.append(emb)

        # Property: all dimensions identical
        dims = [len(e) for e in embeddings]
        assert len(set(dims)) == 1, f"Inconsistent dimensions: {dims}"
        assert dims[0] == fake_dim

    @pytest.mark.asyncio
    async def test_embed_batch_consistent_with_embed(self):
        """embed_batch must return same dimension as embed for each text."""
        from infrastructure.adapters.ollama_embedding_service import OllamaEmbeddingService

        fake_dim = 512
        fake_embedding = [0.5] * fake_dim

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_resp = AsyncMock()
            mock_resp.raise_for_status = MagicMock()
            mock_resp.json = MagicMock(return_value={"embeddings": [fake_embedding, fake_embedding]})

            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client.post = AsyncMock(return_value=mock_resp)
            mock_client_cls.return_value = mock_client

            svc = OllamaEmbeddingService(base_url="http://localhost:11434")
            batch_result = await svc.embed_batch(["text one", "text two"])

        assert len(batch_result) == 2
        assert all(len(e) == fake_dim for e in batch_result), (
            "All batch embeddings must have the same dimension"
        )

    @pytest.mark.asyncio
    async def test_openai_embed_consistent_dimension(self):
        """OpenAIEmbeddingService returns consistent dimensions."""
        pytest.importorskip("openai", reason="openai package not installed")
        from infrastructure.adapters.openai_embedding_service import OpenAIEmbeddingService

        fake_dim = 1536
        fake_vector = [0.0] * fake_dim

        mock_openai = MagicMock()
        mock_openai.embeddings.create = AsyncMock(return_value=MagicMock(
            data=[MagicMock(embedding=fake_vector)]
        ))

        with patch("openai.AsyncOpenAI", return_value=mock_openai):
            svc = OpenAIEmbeddingService(api_key="sk-test")

            texts = ["short", "longer text about machine learning and NLP"]
            embeddings = [await svc.embed(t) for t in texts]

        dims = [len(e) for e in embeddings]
        assert len(set(dims)) == 1, f"Inconsistent OpenAI embedding dimensions: {dims}"


# ===========================================================================
# Task 5.14 — Property: Citation completeness & Cache idempotency
# ===========================================================================

class TestCitationCompleteness:
    """Property 5: ทุก chunk ที่ใช้ใน Context_Window ต้องมี Citation ใน response."""

    @pytest.mark.asyncio
    async def test_chunks_in_context_have_citations(self):
        """QueryUseCase must include a citation for every retrieved chunk used as context."""
        chunks = [
            _make_reranked("c1", "Alice works at Acme Corp.", "doc-a"),
            _make_reranked("c2", "Bob is her manager.", "doc-b"),
        ]

        vs_mock = AsyncMock()
        vs_mock.search = AsyncMock(return_value=chunks)

        reranker_mock = AsyncMock()
        reranker_mock.rerank = AsyncMock(return_value=chunks)

        llm_mock = AsyncMock()
        llm_mock.generate = AsyncMock(return_value="Alice works at Acme Corp. Bob is her manager.")

        uc = _make_use_case(vector_store=vs_mock, reranker=reranker_mock, llm=llm_mock)
        result = await uc.execute(QueryRequest(
            query="Who works at Acme?", use_graph=False, use_cache=False
        ))

        cited_chunk_ids = {c.chunk_id for c in result.citations}
        used_chunk_ids = {"c1", "c2"}

        # Every used chunk must appear in citations
        assert used_chunk_ids.issubset(cited_chunk_ids), (
            f"Missing citations for chunks: {used_chunk_ids - cited_chunk_ids}"
        )

    @pytest.mark.asyncio
    async def test_no_chunks_no_citations(self):
        """When no chunks are retrieved, citations must be empty."""
        vs_mock = AsyncMock()
        vs_mock.search = AsyncMock(return_value=[])

        uc = _make_use_case(vector_store=vs_mock)
        result = await uc.execute(QueryRequest(
            query="anything?", use_graph=False, use_cache=False
        ))

        assert result.citations == []


class TestCacheIdempotency:
    """Property 6: query เดิมสองครั้ง → ครั้งที่สองต้องมาจาก cache (from_cache=True)."""

    @pytest.mark.asyncio
    async def test_same_query_twice_second_from_cache(self):
        """Second identical query should be served from semantic cache."""
        from domain.entities import QueryResult

        first_result = QueryResult(
            request_id="req-cached",
            answer="cached answer from first call",
            citations=[],
            from_cache=False,
        )

        cache_mock = AsyncMock()
        # First call: miss; Second call: hit
        cache_mock.get = AsyncMock(side_effect=[None, first_result])
        cache_mock.set = AsyncMock()

        vs_mock = AsyncMock()
        vs_mock.search = AsyncMock(return_value=[])

        llm_mock = AsyncMock()
        llm_mock.generate = AsyncMock(return_value="live answer")

        uc = _make_use_case(vector_store=vs_mock, llm=llm_mock, cache=cache_mock)
        req = QueryRequest(query="what is rag?", use_graph=False, use_cache=True)

        # First call — cache miss → runs pipeline
        result1 = await uc.execute(req)
        assert result1.from_cache is False

        # Second call — cache hit
        result2 = await uc.execute(req)
        assert result2.from_cache is True
        assert result2.answer == "cached answer from first call"

        # LLM called only once (not twice)
        assert llm_mock.generate.call_count <= 1

    @pytest.mark.asyncio
    async def test_force_refresh_bypasses_cache(self):
        """force_refresh=True must bypass cache even when a hit is available."""
        from domain.entities import QueryResult

        cached = QueryResult(
            request_id="req-x", answer="stale cached answer", citations=[], from_cache=True
        )

        cache_mock = AsyncMock()
        cache_mock.get = AsyncMock(return_value=cached)
        cache_mock.set = AsyncMock()

        vs_mock = AsyncMock()
        vs_mock.search = AsyncMock(return_value=[])

        llm_mock = AsyncMock()
        llm_mock.generate = AsyncMock(return_value="fresh answer")

        uc = _make_use_case(vector_store=vs_mock, llm=llm_mock, cache=cache_mock)
        result = await uc.execute(QueryRequest(
            query="what is rag?", use_graph=False,
            use_cache=True, force_refresh=True
        ))

        # Should get fresh (non-cached) result
        assert result.from_cache is False


# need MagicMock imported
from unittest.mock import MagicMock  # noqa: E402
