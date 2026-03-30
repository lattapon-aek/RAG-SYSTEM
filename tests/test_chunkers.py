"""
Unit tests สำหรับ chunker strategies ของ Ingestion Service
รันได้โดยไม่ต้องการ external services

Usage:
    cd rag-system
    pip install tiktoken pytest pytest-asyncio
    py -3.12 -m pytest tests/test_chunkers.py -v
"""
import sys
import os
import pytest

# Insert ingestion-service root so its packages take precedence
_INGESTION = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "../ingestion/ingestion-service")
)
if _INGESTION not in sys.path:
    sys.path.insert(0, _INGESTION)

import tiktoken  # noqa: F401 — verify it's installed

from infrastructure.adapters.fixed_chunker import FixedChunker
from infrastructure.adapters.hierarchical_chunker import HierarchicalChunker
from infrastructure.adapters.sentence_chunker import SentenceChunker


SAMPLE_TEXT = (
    "Alice works at Acme Corp in Bangkok. "
    "She is a software engineer. "
    "Bob is her manager. "
    "They are building a RAG system together. "
    "The system uses Neo4j for graph storage. "
    "ChromaDB is used as the vector store. "
    "FastAPI powers the REST interface. "
    "Docker containers orchestrate all services. "
) * 20  # ~160 words, ~200 tokens


# ---- FixedChunker ----

@pytest.mark.asyncio
async def test_fixed_chunker_no_text_lost():
    """Property 1: ข้อความทุกส่วนต้องปรากฏใน chunks (ไม่มีหาย)"""
    chunker = FixedChunker(max_tokens=50, overlap_tokens=10)
    chunks = await chunker.chunk(SAMPLE_TEXT, document_id="doc-1")
    combined = " ".join(c.text for c in chunks)
    for word in SAMPLE_TEXT.split():
        assert word in combined, f"Word '{word}' missing from chunks"


@pytest.mark.asyncio
async def test_fixed_chunker_size_bound():
    """Property 2: ทุก chunk ต้องมี token_count ≤ max_tokens"""
    max_tokens = 64
    chunker = FixedChunker(max_tokens=max_tokens, overlap_tokens=8)
    chunks = await chunker.chunk(SAMPLE_TEXT, document_id="doc-1")
    assert len(chunks) > 0
    for chunk in chunks:
        assert chunk.token_count <= max_tokens, (
            f"Chunk {chunk.id} has {chunk.token_count} tokens > {max_tokens}"
        )


@pytest.mark.asyncio
async def test_fixed_chunker_sequence_index():
    """sequence_index ต้องเรียงต่อเนื่อง"""
    chunker = FixedChunker(max_tokens=50, overlap_tokens=5)
    chunks = await chunker.chunk(SAMPLE_TEXT, document_id="doc-1")
    for i, chunk in enumerate(chunks):
        assert chunk.sequence_index == i


@pytest.mark.asyncio
async def test_fixed_chunker_document_id():
    """ทุก chunk ต้องมี document_id และ chunk_type ถูกต้อง"""
    chunker = FixedChunker(max_tokens=50)
    chunks = await chunker.chunk(SAMPLE_TEXT, document_id="my-doc")
    for chunk in chunks:
        assert chunk.document_id == "my-doc"
        assert chunk.chunk_type == "flat"


@pytest.mark.asyncio
async def test_fixed_chunker_empty_text():
    """Empty text ต้องคืน empty list"""
    chunker = FixedChunker(max_tokens=50)
    chunks = await chunker.chunk("", document_id="doc-empty")
    assert chunks == []


# ---- HierarchicalChunker ----

@pytest.mark.asyncio
async def test_hierarchical_parent_child_structure():
    """Property 3: ทุก child chunk ต้องมี parent_chunk_id ที่ชี้ไปยัง parent ที่มีอยู่จริง"""
    chunker = HierarchicalChunker(parent_tokens=100, child_tokens=25)
    chunks = await chunker.chunk(SAMPLE_TEXT, document_id="doc-h")

    parent_ids = {c.id for c in chunks if c.chunk_type == "parent"}
    children = [c for c in chunks if c.chunk_type == "child"]

    assert len(parent_ids) > 0, "ต้องมี parent chunks"
    assert len(children) > 0, "ต้องมี child chunks"

    for child in children:
        assert child.parent_chunk_id is not None, "child ต้องมี parent_chunk_id"
        assert child.parent_chunk_id in parent_ids, (
            f"child.parent_chunk_id={child.parent_chunk_id} ไม่มีใน parent_ids"
        )


@pytest.mark.asyncio
async def test_hierarchical_child_size_bound():
    """child chunk ต้องมี token_count ≤ child_tokens"""
    child_tokens = 32
    chunker = HierarchicalChunker(parent_tokens=128, child_tokens=child_tokens)
    chunks = await chunker.chunk(SAMPLE_TEXT, document_id="doc-h")
    children = [c for c in chunks if c.chunk_type == "child"]
    for child in children:
        assert child.token_count <= child_tokens, (
            f"child {child.id} has {child.token_count} tokens > {child_tokens}"
        )


@pytest.mark.asyncio
async def test_hierarchical_no_text_lost():
    """Property 1 สำหรับ hierarchical: parent chunks ต้องครอบคลุม text ทั้งหมด"""
    chunker = HierarchicalChunker(parent_tokens=100, child_tokens=25)
    chunks = await chunker.chunk(SAMPLE_TEXT, document_id="doc-h")
    parents = [c for c in chunks if c.chunk_type == "parent"]
    combined = " ".join(p.text for p in parents)
    for word in SAMPLE_TEXT.split():
        assert word in combined, f"Word '{word}' missing from parent chunks"


# ---- SentenceChunker ----

@pytest.mark.asyncio
async def test_sentence_chunker_basic():
    """SentenceChunker ต้องคืน chunks ที่ไม่ว่าง"""
    chunker = SentenceChunker(max_tokens=100)
    chunks = await chunker.chunk(SAMPLE_TEXT, document_id="doc-s")
    assert len(chunks) > 0
    for chunk in chunks:
        assert chunk.text.strip() != ""
        assert chunk.document_id == "doc-s"


@pytest.mark.asyncio
async def test_sentence_chunker_namespace():
    """namespace ต้องถูก pass ไปยัง chunks"""
    chunker = SentenceChunker(max_tokens=100)
    chunks = await chunker.chunk(SAMPLE_TEXT, document_id="doc-s", namespace="test-ns")
    for chunk in chunks:
        assert chunk.namespace == "test-ns"
