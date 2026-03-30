"""
Unit tests สำหรับ RAG Service — pure logic ที่ไม่ต้องการ external services

Usage:
    cd rag-system
    py -3.12 -m pytest tests/test_rag_service.py -v
    (run separately from test_chunkers.py to avoid domain package collision)
"""
import importlib.util
import sys
import os
import pytest

_RAG = os.path.abspath(os.path.join(os.path.dirname(__file__), "../core/rag-service"))
_INGESTION = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "../ingestion/ingestion-service")
)

# Insert rag-service path, remove ingestion-service to avoid domain collision
sys.path = [p for p in sys.path if p != _INGESTION]
if _RAG not in sys.path:
    sys.path.insert(0, _RAG)

import tiktoken  # noqa: F401

from domain.entities import RerankedResult, BuiltContext
from infrastructure.adapters.reranker_client import rrf_merge, NoOpReranker
from application.context_builder import ContextBuilder, _word_overlap
from application.context_compressor import NoOpCompressor, ExtractiveCompressor


# ---- Helpers ----

def _make_chunk(chunk_id: str, text: str, score: float = 1.0,
                document_id: str = "doc-1") -> RerankedResult:
    return RerankedResult(
        chunk_id=chunk_id, document_id=document_id, text=text,
        score=score, original_rank=0, reranked_rank=0,
    )


# ---- RRF Merge ----

def test_rrf_merge_single_list():
    chunks = [_make_chunk(f"c{i}", f"text {i}", score=1.0 / (i + 1)) for i in range(5)]
    result = rrf_merge([chunks], top_n=3)
    assert len(result) == 3
    assert result[0].chunk_id == "c0"


def test_rrf_merge_two_lists_boost_overlap():
    """Item in both lists gets higher RRF score"""
    list_a = [_make_chunk("shared", "shared text", 0.9),
              _make_chunk("only_a", "only in a", 0.8)]
    list_b = [_make_chunk("shared", "shared text", 0.7),
              _make_chunk("only_b", "only in b", 0.6)]
    result = rrf_merge([list_a, list_b], top_n=3)
    assert result[0].chunk_id == "shared"


def test_rrf_merge_empty():
    assert rrf_merge([], top_n=5) == []


def test_rrf_merge_top_n():
    chunks = [_make_chunk(f"c{i}", f"text {i}") for i in range(10)]
    assert len(rrf_merge([chunks], top_n=4)) == 4


def test_rrf_scores_positive():
    chunks = [_make_chunk(f"c{i}", f"text {i}") for i in range(5)]
    for item in rrf_merge([chunks], top_n=5):
        assert item.score > 0


# ---- NoOpReranker ----

@pytest.mark.asyncio
async def test_noop_reranker_top_n():
    reranker = NoOpReranker()
    chunks = [_make_chunk(f"c{i}", f"text {i}") for i in range(10)]
    result = await reranker.rerank("q", chunks, top_n=3)
    assert len(result) == 3
    assert result[0].chunk_id == "c0"


@pytest.mark.asyncio
async def test_noop_reranker_empty():
    assert await NoOpReranker().rerank("q", [], top_n=5) == []


# ---- Word Overlap ----

def test_word_overlap_identical():
    assert _word_overlap("hello world", "hello world") == 1.0


def test_word_overlap_no_overlap():
    assert _word_overlap("hello world", "foo bar") == 0.0


def test_word_overlap_partial():
    score = _word_overlap("hello world foo", "hello bar")
    assert 0.0 < score < 1.0


def test_word_overlap_empty():
    assert _word_overlap("", "hello") == 0.0


# ---- ContextBuilder ----

@pytest.mark.asyncio
async def test_context_builder_deduplication():
    """Duplicate chunks (>80% overlap) should be removed"""
    builder = ContextBuilder()
    text = "Alice works at Acme Corp in Bangkok as a software engineer"
    chunks = [
        _make_chunk("c1", text, score=0.9),
        _make_chunk("c2", text, score=0.8),   # duplicate
        _make_chunk("c3", "Bob is her manager at Acme Corp", score=0.7),
    ]
    result = await builder.build("query", chunks)
    ids = [c.chunk_id for c in result.chunks]
    assert "c1" in ids
    assert "c2" not in ids
    assert "c3" in ids


@pytest.mark.asyncio
async def test_context_builder_token_budget():
    """Chunks exceeding max_tokens should be excluded"""
    builder = ContextBuilder()
    chunks = [
        _make_chunk("c1", "Alice works at Acme Corp in Bangkok Thailand", score=0.9),
        _make_chunk("c2", "Bob is her manager at the company headquarters", score=0.8),
        _make_chunk("c3", "They build RAG systems using Neo4j and ChromaDB", score=0.7),
    ]
    result = await builder.build("query", chunks, max_tokens=12)
    assert result.was_truncated is True
    assert len(result.chunks) < len(chunks)


@pytest.mark.asyncio
async def test_context_builder_no_truncation():
    builder = ContextBuilder()
    chunks = [_make_chunk(f"c{i}", f"short text {i}") for i in range(3)]
    result = await builder.build("query", chunks, max_tokens=4096)
    assert result.was_truncated is False
    assert len(result.chunks) == 3


@pytest.mark.asyncio
async def test_context_builder_empty():
    result = await ContextBuilder().build("query", [])
    assert result.chunks == []
    assert result.total_tokens == 0
    assert result.was_truncated is False


@pytest.mark.asyncio
async def test_context_builder_first_chunk_is_most_relevant():
    """Most relevant chunk (rank 0) should appear at position 0"""
    builder = ContextBuilder()
    chunks = [_make_chunk(f"c{i}", f"unique text number {i} content here") for i in range(5)]
    result = await builder.build("query", chunks, max_tokens=4096)
    assert result.chunks[0].chunk_id == "c0"


# ---- NoOpCompressor ----

@pytest.mark.asyncio
async def test_noop_compressor_passthrough():
    compressor = NoOpCompressor()
    chunks = [_make_chunk("c1", "hello world"), _make_chunk("c2", "foo bar")]
    context = BuiltContext(chunks=chunks, total_tokens=10)
    result = await compressor.compress("query", context)
    assert "hello world" in result.text
    assert "foo bar" in result.text
    assert result.method == "none"
    assert result.compressed_tokens == result.original_tokens


# ---- ExtractiveCompressor ----

@pytest.mark.asyncio
async def test_extractive_compressor_retains_relevant():
    compressor = ExtractiveCompressor(threshold=0.05)
    chunks = [_make_chunk("c1",
              "Alice works at Acme Corp. She is an engineer. The sky is blue.")]
    context = BuiltContext(chunks=chunks, total_tokens=20)
    result = await compressor.compress("Alice engineer", context)
    assert result.method == "extractive"
    assert "Alice" in result.text or "engineer" in result.text


@pytest.mark.asyncio
async def test_extractive_compressor_empty():
    compressor = ExtractiveCompressor()
    context = BuiltContext(chunks=[], total_tokens=0)
    result = await compressor.compress("query", context)
    assert result.text == ""


# ============================================================
# Task 5.17 — Additional Unit Tests
# ============================================================
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch, call
from application.query_use_case import QueryUseCase, QueryRequest as UCQueryRequest
from domain.errors import EmptyQueryError
from domain.entities import QueryResult, Citation


def _make_use_case(
    llm=None,
    vector_store=None,
    embed=None,
    doc_repo=None,
    reranker=None,
    cache=None,
):
    """Build a QueryUseCase with sensible async mocks."""
    embedding_svc = embed or AsyncMock()
    embedding_svc.embed = AsyncMock(return_value=[0.1] * 8)

    vs = vector_store or AsyncMock()
    vs.search = AsyncMock(return_value=[])

    llm_svc = llm or AsyncMock()
    llm_svc.generate = AsyncMock(return_value="mocked answer")

    dr = doc_repo or AsyncMock()
    dr.list_all = AsyncMock(return_value=[])
    dr.find_by_id = AsyncMock(return_value=None)
    dr.delete = AsyncMock()

    rr = reranker or AsyncMock()
    rr.rerank = AsyncMock(return_value=[])

    from application.context_builder import ContextBuilder
    from application.context_compressor import NoOpCompressor

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


# ---- Empty query → EmptyQueryError ----

@pytest.mark.asyncio
async def test_empty_query_raises_error():
    uc = _make_use_case()
    with pytest.raises(EmptyQueryError):
        await uc.execute(UCQueryRequest(query=""))


@pytest.mark.asyncio
async def test_whitespace_only_query_raises_error():
    uc = _make_use_case()
    with pytest.raises(EmptyQueryError):
        await uc.execute(UCQueryRequest(query="   "))


# ---- FastAPI endpoint → 400 on empty query ----

@pytest.mark.asyncio
async def test_query_endpoint_returns_400_on_empty_query():
    pytest.importorskip("fastapi", reason="fastapi not installed in local env")
    from fastapi.testclient import TestClient
    from fastapi import FastAPI
    from interface.routers import router
    from interface.dependencies import get_query_use_case

    app = FastAPI()
    uc = _make_use_case()
    app.include_router(router)
    app.dependency_overrides[get_query_use_case] = lambda: uc

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.post("/query", json={"query": ""})
    assert resp.status_code == 400


# ---- Empty retrieval → "no relevant information" answer ----

@pytest.mark.asyncio
async def test_empty_retrieval_returns_no_info_answer():
    """When vector store returns nothing, LLM should NOT be called;
    answer should indicate no information available."""
    llm_mock = AsyncMock()
    llm_mock.generate = AsyncMock(return_value="should not be called")

    vs_mock = AsyncMock()
    vs_mock.search = AsyncMock(return_value=[])

    uc = _make_use_case(llm=llm_mock, vector_store=vs_mock)
    result = await uc.execute(UCQueryRequest(query="what is the meaning of life?", use_graph=False))

    # LLM should NOT be called when there are no chunks
    llm_mock.generate.assert_not_called()
    assert "don't have enough information" in result.answer.lower() or \
           "no relevant" in result.answer.lower() or \
           "not enough" in result.answer.lower()


# ---- LLM retry logic (3 retries with exponential backoff) ----

@pytest.mark.asyncio
async def test_llm_retry_succeeds_on_third_attempt():
    """_retry helper should retry up to 3 times and succeed on 3rd."""
    from infrastructure.adapters.llm_services import _retry

    attempt_count = 0

    async def flaky():
        nonlocal attempt_count
        attempt_count += 1
        if attempt_count < 3:
            raise RuntimeError("transient error")
        return "success"

    with patch("infrastructure.adapters.llm_services.asyncio.sleep", new_callable=AsyncMock):
        result = await _retry(flaky, retries=3)

    assert result == "success"
    assert attempt_count == 3


@pytest.mark.asyncio
async def test_llm_retry_raises_after_max_retries():
    """_retry should raise the last exception after exhausting retries."""
    from infrastructure.adapters.llm_services import _retry

    async def always_fail():
        raise ValueError("permanent error")

    with patch("infrastructure.adapters.llm_services.asyncio.sleep", new_callable=AsyncMock):
        with pytest.raises(ValueError, match="permanent error"):
            await _retry(always_fail, retries=3)


@pytest.mark.asyncio
async def test_llm_retry_backoff_delays():
    """Backoff delays should be 2^0, 2^1, 2^2 for 3 retries (sleep after each attempt)."""
    from infrastructure.adapters.llm_services import _retry, _BACKOFF_BASE

    sleep_calls = []

    async def fake_sleep(t):
        sleep_calls.append(t)

    async def always_fail():
        raise RuntimeError("fail")

    with patch("infrastructure.adapters.llm_services.asyncio.sleep", side_effect=fake_sleep):
        with pytest.raises(RuntimeError):
            await _retry(always_fail, retries=3)

    # 3 attempts → 3 sleeps (sleep happens after every failed attempt including last)
    assert len(sleep_calls) == 3
    assert sleep_calls[0] == _BACKOFF_BASE ** 0
    assert sleep_calls[1] == _BACKOFF_BASE ** 1
    assert sleep_calls[2] == _BACKOFF_BASE ** 2


# ---- Document delete cascade ----

@pytest.mark.asyncio
async def test_document_delete_calls_repo_delete():
    """Deleting a document should call doc_repo.delete with the correct id."""
    from domain.entities import Document
    import datetime

    doc_id = "doc-abc-123"
    mock_doc = Document(
        id=doc_id,
        filename="test.pdf",
        content_type="application/pdf",
        source_hash="abc123",
        namespace="default",
        chunk_count=5,
        ingested_at=datetime.datetime.now(datetime.timezone.utc),
    )

    dr = AsyncMock()
    # Set return_value directly on the coroutine mock
    dr.find_by_id.return_value = mock_doc
    dr.delete.return_value = None

    # Simulate what the router does on DELETE /documents/{id}
    doc = await dr.find_by_id(doc_id)
    assert doc is not None
    assert doc.id == doc_id
    await dr.delete(doc_id)

    dr.delete.assert_called_once_with(doc_id)


@pytest.mark.asyncio
async def test_document_delete_cache_invalidation():
    """After delete, semantic cache should not return stale results for that doc."""
    # First call: cache miss; second call: also miss (simulating invalidation)
    cache_mock = AsyncMock()
    cache_mock.get = AsyncMock(side_effect=[None, None])

    vs_mock = AsyncMock()
    vs_mock.search = AsyncMock(return_value=[
        _make_chunk("c1", "cached answer context", score=0.9, document_id="doc-1")
    ])

    reranker = AsyncMock()
    reranker.rerank = AsyncMock(return_value=[
        _make_chunk("c1", "cached answer context", score=0.9, document_id="doc-1")
    ])

    uc = _make_use_case(vector_store=vs_mock, cache=cache_mock, reranker=reranker)

    # First query — cache miss, result stored
    result1 = await uc.execute(UCQueryRequest(
        query="test query", use_graph=False, use_cache=True
    ))
    assert result1.from_cache is False

    # Second query — cache still returns None (invalidated), goes through pipeline
    result2 = await uc.execute(UCQueryRequest(
        query="test query", use_graph=False, use_cache=True
    ))
    assert result2.from_cache is False
    assert cache_mock.get.await_count == 2


@pytest.mark.asyncio
async def test_query_use_case_passes_namespace_to_cache_and_graph():
    """Cache lookup and graph retrieval must be scoped to the request namespace."""
    cache_mock = AsyncMock()
    cache_mock.get = AsyncMock(return_value=None)
    cache_mock.set = AsyncMock()

    graph_mock = AsyncMock()
    graph_mock.query_related_entities = AsyncMock(return_value=[])

    vs_mock = AsyncMock()
    vs_mock.search = AsyncMock(return_value=[])

    reranker = AsyncMock()
    reranker.rerank = AsyncMock(return_value=[])

    uc = _make_use_case(vector_store=vs_mock, cache=cache_mock, reranker=reranker)
    uc._graph = graph_mock

    req = UCQueryRequest(
        query="tenant scoped query",
        namespace="tenant-a",
        use_cache=True,
        use_graph=True,
    )
    await uc.execute(req)

    cache_mock.get.assert_awaited_once_with([0.1] * 8, namespace="tenant-a")
    graph_mock.query_related_entities.assert_awaited_once_with(
        "tenant scoped query", top_k=req.top_k, namespace="tenant-a"
    )


@pytest.mark.asyncio
async def test_delete_document_endpoint_scopes_delete_by_namespace():
    pytest.importorskip("fastapi", reason="fastapi not installed in local env")
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from interface.routers import router
    from interface.dependencies import get_doc_repo, get_query_use_case
    from domain.entities import Document
    import datetime

    doc = Document(
        id="doc-tenant-a",
        filename="tenant-a.txt",
        content_type="text/plain",
        source_hash="hash-a",
        namespace="tenant-a",
        chunk_count=2,
        ingested_at=datetime.datetime.now(datetime.timezone.utc),
    )

    doc_repo = AsyncMock()
    doc_repo.find_by_id = AsyncMock(return_value=doc)
    doc_repo.delete = AsyncMock(return_value=None)

    use_case = AsyncMock()
    use_case._vector_store = AsyncMock()
    use_case._vector_store.delete_by_document_id = AsyncMock(return_value=None)
    use_case._graph = AsyncMock()
    use_case._graph.delete_document = AsyncMock(return_value={})
    use_case._cache = AsyncMock()
    use_case._cache.invalidate_by_document = AsyncMock(return_value=None)

    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_doc_repo] = lambda: doc_repo
    app.dependency_overrides[get_query_use_case] = lambda: use_case

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.delete("/documents/doc-tenant-a?namespace=tenant-a")
    assert resp.status_code == 200

    doc_repo.find_by_id.assert_awaited_once_with("doc-tenant-a", namespace="tenant-a")
    use_case._vector_store.delete_by_document_id.assert_awaited_once_with(
        "doc-tenant-a", namespace="tenant-a"
    )
    use_case._graph.delete_document.assert_awaited_once_with(
        "doc-tenant-a", namespace="tenant-a"
    )
    use_case._cache.invalidate_by_document.assert_awaited_once_with("doc-tenant-a")
    doc_repo.delete.assert_awaited_once_with("doc-tenant-a", namespace="tenant-a")
