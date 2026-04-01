"""
Task 20.4 — Unit tests สำหรับ Streaming Response

Tests:
- stream=True returns SSE events in order: token → citations → done
- Cache hit streams word-by-word (token events) before citations/done
- Events are valid JSON with correct type field
- No chunks → streams "I don't have enough information" token event

Usage:
    cd rag-system
    py -3.12 -m pytest tests/test_streaming.py -v
"""
import sys
import os
import json
import asyncio

_RAG = os.path.abspath(os.path.join(os.path.dirname(__file__), "../core/rag-service"))
for _mod in list(sys.modules.keys()):
    if _mod.split(".")[0] in ("application", "domain", "infrastructure", "interface"):
        del sys.modules[_mod]
if _RAG not in sys.path:
    sys.path.insert(0, _RAG)

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from application.query_use_case import QueryUseCase, QueryRequest, _sse_event
from domain.entities import QueryResult, RerankedResult, Citation


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_reranked(text: str, chunk_id: str = "c1") -> RerankedResult:
    return RerankedResult(
        chunk_id=chunk_id,
        document_id="doc1",
        text=text,
        score=0.9,
        original_rank=0,
        reranked_rank=0,
        metadata={"filename": "test.txt", "sequence_index": 0},
    )


def _make_citation(text: str = "snippet") -> Citation:
    return Citation(
        chunk_id="c1",
        document_id="doc1",
        filename="test.txt",
        text_snippet=text,
        score=0.9,
        sequence_index=0,
    )


async def _collect_stream(gen):
    """Collect all SSE events from an async generator into a list of parsed dicts."""
    events = []
    async for line in gen:
        if line.startswith("data: "):
            events.append(json.loads(line[6:]))
    return events


def _make_cached_result(answer: str) -> QueryResult:
    return QueryResult(
        request_id="cached-req",
        answer=answer,
        citations=[_make_citation()],
        grounding_score=1.0,
        low_confidence=False,
    )


class _FakeLLM:
    """LLM that streams tokens from a fixed answer."""

    def __init__(self, tokens=("Hello", " world", "!")):
        self.tokens = tokens

    async def generate(self, prompt, system_prompt=None, max_tokens=512):
        return "".join(self.tokens)

    async def generate_stream(self, prompt, system_prompt=None, max_tokens=512):
        for token in self.tokens:
            yield token


class _FakeContextChunk:
    def __init__(self, text, chunk_id="c1"):
        self.text = text
        self.chunk_id = chunk_id
        self.document_id = "doc1"
        self.score = 0.9
        self.metadata = {"filename": "test.txt", "sequence_index": 0}


class _FakeContext:
    def __init__(self, chunks, was_truncated=False):
        self.chunks = chunks
        self.was_truncated = was_truncated


def _make_use_case(llm_tokens=("Hello", " world"), reranked=None, cache_hit=None):
    """Build a QueryUseCase with all dependencies mocked."""
    embed = AsyncMock()
    embed.embed = AsyncMock(return_value=[0.1] * 8)

    vector_store = AsyncMock()
    reranked_chunks = reranked or [_make_reranked("Hello world context")]
    vector_store.search = AsyncMock(return_value=reranked_chunks)

    llm = _FakeLLM(tokens=llm_tokens)

    doc_repo = AsyncMock()
    doc_repo._get_pool = AsyncMock(return_value=AsyncMock())

    reranker = AsyncMock()
    reranker.rerank = AsyncMock(return_value=reranked_chunks)

    fake_context = _FakeContext(
        chunks=[_FakeContextChunk("Hello world context")],
    )
    ctx_builder = AsyncMock()
    ctx_builder.build = AsyncMock(return_value=fake_context)

    compressor = AsyncMock()
    compressor.compress = AsyncMock(return_value=MagicMock(text="compressed"))

    cache = AsyncMock()
    cache.get = AsyncMock(return_value=cache_hit)
    cache.set = AsyncMock()

    uc = QueryUseCase(
        embedding_service=embed,
        vector_store=vector_store,
        llm_service=llm,
        document_repository=doc_repo,
        reranker=reranker,
        context_builder=ctx_builder,
        context_compressor=compressor,
        semantic_cache=cache,
    )
    return uc


# ---------------------------------------------------------------------------
# Tests: _sse_event helper
# ---------------------------------------------------------------------------

def test_sse_event_format():
    result = _sse_event("token", {"content": "hi"})
    assert result.startswith("data: ")
    assert result.endswith("\n\n")
    parsed = json.loads(result[6:])
    assert parsed["type"] == "token"
    assert parsed["content"] == "hi"


def test_sse_event_type_injected():
    result = _sse_event("done", {"request_id": "abc"})
    parsed = json.loads(result[6:])
    assert parsed["type"] == "done"
    assert parsed["request_id"] == "abc"


# ---------------------------------------------------------------------------
# Tests: execute_stream — normal path
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_stream_event_order():
    """SSE events must arrive in order: token(s) → citations → done."""
    uc = _make_use_case(llm_tokens=("Hello", " world"))
    req = QueryRequest(query="what is hello?", use_cache=False)
    events = await _collect_stream(uc.execute_stream(req))

    types = [e["type"] for e in events]
    # All tokens come before citations and done
    assert "token" in types
    first_citations = next(i for i, t in enumerate(types) if t == "citations")
    first_done = next(i for i, t in enumerate(types) if t == "done")
    last_token = max(i for i, t in enumerate(types) if t == "token")
    assert last_token < first_citations < first_done


@pytest.mark.asyncio
async def test_stream_token_events_contain_content():
    uc = _make_use_case(llm_tokens=("Foo", "Bar"))
    req = QueryRequest(query="test", use_cache=False)
    events = await _collect_stream(uc.execute_stream(req))
    token_contents = [e["content"] for e in events if e["type"] == "token"]
    assert "Foo" in token_contents
    assert "Bar" in token_contents


@pytest.mark.asyncio
async def test_stream_citations_event_has_citations_and_grounding():
    uc = _make_use_case(llm_tokens=("Answer",))
    req = QueryRequest(query="test", use_cache=False)
    events = await _collect_stream(uc.execute_stream(req))
    citations_event = next(e for e in events if e["type"] == "citations")
    assert "citations" in citations_event
    assert "grounding_score" in citations_event
    assert "low_confidence" in citations_event
    assert isinstance(citations_event["grounding_score"], float)
    assert 0.0 <= citations_event["grounding_score"] <= 1.0


@pytest.mark.asyncio
async def test_stream_done_event_has_request_id_and_latency():
    uc = _make_use_case()
    req = QueryRequest(query="test", use_cache=False)
    events = await _collect_stream(uc.execute_stream(req))
    done = next(e for e in events if e["type"] == "done")
    assert "request_id" in done
    assert "total_latency_ms" in done
    assert done["from_cache"] is False


@pytest.mark.asyncio
async def test_stream_assembled_answer_matches_tokens():
    """The tokens streamed should contain the assembled answer tokens (may include warning suffix)."""
    # Use context-matching tokens so citation verifier doesn't add a warning suffix
    tokens = ("Hello", " world", " context")
    uc = _make_use_case(llm_tokens=tokens)
    req = QueryRequest(query="what is hello?", use_cache=False)
    events = await _collect_stream(uc.execute_stream(req))
    assembled = "".join(e["content"] for e in events if e["type"] == "token")
    assert "Hello" in assembled
    assert "world" in assembled


# ---------------------------------------------------------------------------
# Tests: execute_stream — cache hit path
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_stream_cache_hit_yields_token_events():
    """Cache hit should stream the cached answer word-by-word."""
    cached = _make_cached_result("Hello cached world")
    uc = _make_use_case(cache_hit=cached)
    req = QueryRequest(query="test", use_cache=True)
    events = await _collect_stream(uc.execute_stream(req))
    token_events = [e for e in events if e["type"] == "token"]
    assert len(token_events) >= 1  # at least one token event


@pytest.mark.asyncio
async def test_stream_cache_hit_event_order():
    """Cache hit: token events then citations then done."""
    cached = _make_cached_result("Cached answer here")
    uc = _make_use_case(cache_hit=cached)
    req = QueryRequest(query="test", use_cache=True)
    events = await _collect_stream(uc.execute_stream(req))
    types = [e["type"] for e in events]
    assert "token" in types
    assert "citations" in types
    assert "done" in types
    first_done = types.index("done")
    first_citations = types.index("citations")
    assert first_citations < first_done


@pytest.mark.asyncio
async def test_stream_cache_hit_done_from_cache_true():
    cached = _make_cached_result("Some answer")
    uc = _make_use_case(cache_hit=cached)
    req = QueryRequest(query="test", use_cache=True)
    events = await _collect_stream(uc.execute_stream(req))
    done = next(e for e in events if e["type"] == "done")
    assert done["from_cache"] is True


# ---------------------------------------------------------------------------
# Tests: execute_stream — no context path
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_stream_no_chunks_yields_no_info_token():
    """When KB is empty, stream the 'no information' message."""
    embed = AsyncMock()
    embed.embed = AsyncMock(return_value=[0.1] * 8)
    vector_store = AsyncMock()
    vector_store.search = AsyncMock(return_value=[])
    llm = _FakeLLM()
    doc_repo = AsyncMock()
    doc_repo._get_pool = AsyncMock(return_value=AsyncMock())
    reranker = AsyncMock()
    reranker.rerank = AsyncMock(return_value=[])
    fake_context = _FakeContext(chunks=[])
    ctx_builder = AsyncMock()
    ctx_builder.build = AsyncMock(return_value=fake_context)
    compressor = AsyncMock()
    cache = AsyncMock()
    cache.get = AsyncMock(return_value=None)
    cache.set = AsyncMock()

    uc = QueryUseCase(
        embedding_service=embed,
        vector_store=vector_store,
        llm_service=llm,
        document_repository=doc_repo,
        reranker=reranker,
        context_builder=ctx_builder,
        context_compressor=compressor,
        semantic_cache=cache,
    )

    req = QueryRequest(query="unknown topic", use_cache=False)
    events = await _collect_stream(uc.execute_stream(req))
    token_events = [e for e in events if e["type"] == "token"]
    combined = "".join(e["content"] for e in token_events)
    assert "I don't have enough information" in combined


# ---------------------------------------------------------------------------
# Tests: all SSE events are valid JSON
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_all_events_are_valid_json():
    uc = _make_use_case(llm_tokens=("A", "B", "C"))
    req = QueryRequest(query="test question", use_cache=False)
    events = await _collect_stream(uc.execute_stream(req))
    # _collect_stream already parses JSON — if we got here, all lines were valid
    assert len(events) > 0
    for event in events:
        assert "type" in event
