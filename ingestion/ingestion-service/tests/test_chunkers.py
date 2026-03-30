"""
Unit tests สำหรับ chunker strategies
รันจาก: rag-system/ingestion/ingestion-service/
    py -3.12 -m pytest tests/test_chunkers.py -v
"""
import pytest
from infrastructure.adapters.fixed_chunker import FixedChunker
from infrastructure.adapters.hierarchical_chunker import HierarchicalChunker
from infrastructure.adapters.semantic_chunker import SemanticChunker
from infrastructure.adapters.sentence_chunker import SentenceChunker
import infrastructure.adapters.tokenizer_utils as tokenizer_utils


SAMPLE_TEXT = (
    "Alice works at Acme Corp in Bangkok. "
    "She is a software engineer. "
    "Bob is her manager. "
    "They are building a RAG system together. "
    "The system uses Neo4j for graph storage. "
    "ChromaDB is used as the vector store. "
    "FastAPI powers the REST interface. "
    "Docker containers orchestrate all services. "
) * 20


@pytest.mark.asyncio
async def test_fixed_no_text_lost():
    chunker = FixedChunker(max_tokens=50, overlap_tokens=10)
    chunks = await chunker.chunk(SAMPLE_TEXT, document_id="doc-1")
    combined = " ".join(c.text for c in chunks)
    for word in SAMPLE_TEXT.split():
        assert word in combined


@pytest.mark.asyncio
async def test_fixed_size_bound():
    max_tokens = 64
    chunker = FixedChunker(max_tokens=max_tokens, overlap_tokens=8)
    chunks = await chunker.chunk(SAMPLE_TEXT, document_id="doc-1")
    assert len(chunks) > 0
    for chunk in chunks:
        assert chunk.token_count <= max_tokens


@pytest.mark.asyncio
async def test_fixed_sequence_index():
    chunker = FixedChunker(max_tokens=50, overlap_tokens=5)
    chunks = await chunker.chunk(SAMPLE_TEXT, document_id="doc-1")
    for i, chunk in enumerate(chunks):
        assert chunk.sequence_index == i


@pytest.mark.asyncio
async def test_fixed_empty_text():
    chunker = FixedChunker(max_tokens=50)
    chunks = await chunker.chunk("", document_id="doc-empty")
    assert chunks == []


@pytest.mark.asyncio
async def test_hierarchical_parent_child_structure():
    chunker = HierarchicalChunker(parent_tokens=100, child_tokens=25)
    chunks = await chunker.chunk(SAMPLE_TEXT, document_id="doc-h")
    parent_ids = {c.id for c in chunks if c.chunk_type == "parent"}
    children = [c for c in chunks if c.chunk_type == "child"]
    assert len(parent_ids) > 0
    assert len(children) > 0
    for child in children:
        assert child.parent_chunk_id is not None
        assert child.parent_chunk_id in parent_ids


@pytest.mark.asyncio
async def test_hierarchical_child_size_bound():
    child_tokens = 32
    chunker = HierarchicalChunker(parent_tokens=128, child_tokens=child_tokens)
    chunks = await chunker.chunk(SAMPLE_TEXT, document_id="doc-h")
    for child in [c for c in chunks if c.chunk_type == "child"]:
        assert child.token_count <= child_tokens


@pytest.mark.asyncio
async def test_hierarchical_no_text_lost():
    chunker = HierarchicalChunker(parent_tokens=100, child_tokens=25)
    chunks = await chunker.chunk(SAMPLE_TEXT, document_id="doc-h")
    combined = " ".join(c.text for c in chunks if c.chunk_type == "parent")
    for word in SAMPLE_TEXT.split():
        assert word in combined


@pytest.mark.asyncio
async def test_sentence_chunker_basic():
    chunker = SentenceChunker(max_tokens=100)
    chunks = await chunker.chunk(SAMPLE_TEXT, document_id="doc-s")
    assert len(chunks) > 0
    for chunk in chunks:
        assert chunk.text.strip() != ""


@pytest.mark.asyncio
async def test_sentence_chunker_namespace():
    chunker = SentenceChunker(max_tokens=100)
    chunks = await chunker.chunk(SAMPLE_TEXT, document_id="doc-s", namespace="test-ns")
    for chunk in chunks:
        assert chunk.namespace == "test-ns"


@pytest.mark.asyncio
async def test_fixed_chunker_falls_back_when_tiktoken_unavailable(monkeypatch):
    monkeypatch.setattr(
        tokenizer_utils.tiktoken,
        "get_encoding",
        lambda _name: (_ for _ in ()).throw(RuntimeError("offline")),
    )
    chunker = FixedChunker(max_tokens=20, overlap_tokens=5)
    chunks = await chunker.chunk("offline tokenizer fallback still preserves text", document_id="doc-offline")
    assert len(chunks) > 0
    assert "offline tokenizer fallback" in " ".join(chunk.text for chunk in chunks)


@pytest.mark.asyncio
async def test_semantic_chunker_requires_embedding_backend():
    with pytest.raises(ValueError, match="requires embedding_fn or embed_batch_fn"):
        SemanticChunker()


@pytest.mark.asyncio
async def test_semantic_chunker_uses_embed_batch_backend():
    calls = []

    async def embed_batch(texts):
        calls.append(list(texts))
        return [
            [1.0, 0.0],
            [0.98, 0.02],
            [0.0, 1.0],
        ]

    text = (
        "## Team Overview\n\n"
        "Alice handles delivery planning.\n\n"
        "Alice also reviews architecture.\n\n"
        "## Operations\n\n"
        "Redis powers the cache layer."
    )
    chunker = SemanticChunker(
        max_tokens=200,
        similarity_threshold=0.8,
        embed_batch_fn=embed_batch,
    )

    chunks = await chunker.chunk(text, document_id="doc-semantic")

    assert len(calls) == 1
    assert len(calls[0]) == 3
    assert len(chunks) == 2
    assert all(chunk.chunk_type == "semantic" for chunk in chunks)
    assert "Team Overview" in chunks[0].text
    assert "Operations" in chunks[1].text


@pytest.mark.asyncio
async def test_semantic_chunker_keeps_thai_heading_and_paragraph_boundaries():
    thai_text = """
## ภาพรวมทีม ABAP

ทีม ABAP รับผิดชอบงาน SAP ทั้งงานโครงการ งาน CR และงานแก้ปัญหา

## ลทธพล

ลทธพลดูแลงานวิเคราะห์ requirement และมอบหมายงานในทีม

## ศภกร

ศภกรเหมาะกับงานที่ซับซ้อนและงานเชิงเทคนิคสูง
""".strip()

    async def embed_batch(texts):
        vectors = {
            "## ภาพรวมทีม ABAP\n\nทีม ABAP รับผิดชอบงาน SAP ทั้งงานโครงการ งาน CR และงานแก้ปัญหา": [1.0, 0.0],
            "## ลทธพล\n\nลทธพลดูแลงานวิเคราะห์ requirement และมอบหมายงานในทีม": [0.95, 0.05],
            "## ศภกร\n\nศภกรเหมาะกับงานที่ซับซ้อนและงานเชิงเทคนิคสูง": [0.0, 1.0],
        }
        return [vectors[text] for text in texts]

    chunker = SemanticChunker(
        max_tokens=256,
        similarity_threshold=0.75,
        embed_batch_fn=embed_batch,
    )

    chunks = await chunker.chunk(thai_text, document_id="doc-th")

    assert len(chunks) == 3
    assert chunks[0].text.startswith("## ภาพรวมทีม ABAP")
    assert chunks[1].text.startswith("## ลทธพล")
    assert chunks[2].text.startswith("## ศภกร")


@pytest.mark.asyncio
async def test_semantic_chunker_structural_fallback_is_not_silent_default():
    async def failing_embed_batch(_texts):
        raise RuntimeError("embedding backend unavailable")

    text = (
        "## A\n\n"
        "Paragraph one about planning.\n\n"
        "## B\n\n"
        "Paragraph two about delivery."
    )
    chunker = SemanticChunker(max_tokens=128, embed_batch_fn=failing_embed_batch)

    chunks = await chunker.chunk(text, document_id="doc-fallback")

    assert len(chunks) == 2
    assert all(chunk.chunk_type == "semantic" for chunk in chunks)
    assert chunks[0].text.startswith("## A")
    assert chunks[1].text.startswith("## B")
