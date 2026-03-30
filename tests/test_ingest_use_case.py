"""
Task 2.7 — Unit tests สำหรับ IngestDocumentUseCase
ทดสอบ error cases และ re-ingestion behaviour โดยไม่ต้องการ external services

Usage:
    cd rag-system
    py -3.12 -m pytest tests/test_ingest_use_case.py -v
"""
import sys
import os
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

_INGESTION = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "../ingestion/ingestion-service")
)
if _INGESTION not in sys.path:
    sys.path.insert(0, _INGESTION)

from application.ingest_document_use_case import IngestDocumentUseCase, IngestRequest
from domain.errors import (
    UnsupportedFileFormatError, CorruptedFileError, EmptyDocumentError,
)
from domain.entities import Document, Chunk


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_doc(doc_id: str = "doc-1", source_hash: str = "abc") -> Document:
    import datetime
    return Document(
        id=doc_id,
        filename="test.txt",
        mime_type="text/plain",
        source_hash=source_hash,
        namespace="default",
        chunk_count=0,
        ingested_at=datetime.datetime.now(datetime.timezone.utc),
    )


def _make_chunk(doc_id: str = "doc-1", idx: int = 0) -> Chunk:
    return Chunk(
        id=f"chunk-{idx}",
        document_id=doc_id,
        text=f"chunk text {idx}",
        token_count=10,
        sequence_index=idx,
        chunk_type="flat",
        namespace="default",
    )


def _make_use_case(
    parser=None, chunker=None, embedding=None, vector_store=None,
    doc_repo=None, graph_client=None,
):
    p = parser or AsyncMock()
    c = chunker or AsyncMock()
    e = embedding or AsyncMock()
    v = vector_store or AsyncMock()
    d = doc_repo or AsyncMock()
    g = graph_client or AsyncMock()

    # Default: parse returns a simple doc + text
    if parser is None:
        p.parse = AsyncMock(return_value=("sample text content", _make_doc()))
    # Default: chunker returns one chunk
    if chunker is None:
        c.chunk = AsyncMock(return_value=[_make_chunk()])
    # Default: embedding returns list of vectors
    if embedding is None:
        e.embed_batch = AsyncMock(return_value=[[0.1] * 8])
    # Default: no existing document
    if doc_repo is None:
        d.find_by_source_hash = AsyncMock(return_value=None)
        d.save = AsyncMock()
        d.update_chunk_count = AsyncMock()
        d.delete = AsyncMock()
    if vector_store is None:
        v.upsert = AsyncMock()
        v.delete_by_document_id = AsyncMock()
    if graph_client is None:
        g.extract_entities = AsyncMock()

    return IngestDocumentUseCase(
        parser=p, chunker=c, embedding_service=e,
        vector_store=v, document_repository=d, graph_service_client=g,
    )


def _make_request(**kwargs) -> IngestRequest:
    defaults = dict(
        content=b"hello world document content",
        filename="test.txt",
        mime_type="text/plain",
    )
    defaults.update(kwargs)
    return IngestRequest(**defaults)


# ---------------------------------------------------------------------------
# Error cases
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_unsupported_format_propagates():
    """Parser raises UnsupportedFileFormatError → use case re-raises it."""
    parser = AsyncMock()
    parser.parse = AsyncMock(side_effect=UnsupportedFileFormatError("pdf not supported"))

    uc = _make_use_case(parser=parser)
    with pytest.raises(UnsupportedFileFormatError):
        await uc.execute(_make_request(filename="bad.xyz", mime_type="application/x-unknown"))


@pytest.mark.asyncio
async def test_corrupted_file_propagates():
    """Parser raises CorruptedFileError → use case re-raises it."""
    parser = AsyncMock()
    parser.parse = AsyncMock(side_effect=CorruptedFileError("cannot read PDF"))

    uc = _make_use_case(parser=parser)
    with pytest.raises(CorruptedFileError):
        await uc.execute(_make_request(filename="corrupt.pdf", mime_type="application/pdf"))


@pytest.mark.asyncio
async def test_zero_chunks_raises_empty_document_error():
    """Chunker returns empty list → EmptyDocumentError must be raised."""
    chunker = AsyncMock()
    chunker.chunk = AsyncMock(return_value=[])

    uc = _make_use_case(chunker=chunker)
    with pytest.raises(EmptyDocumentError):
        await uc.execute(_make_request())


@pytest.mark.asyncio
async def test_successful_ingest_returns_doc_id_and_chunk_count():
    chunks = [_make_chunk(idx=i) for i in range(3)]
    chunker = AsyncMock()
    chunker.chunk = AsyncMock(return_value=chunks)

    embed = AsyncMock()
    embed.embed_batch = AsyncMock(return_value=[[0.1] * 8] * 3)

    uc = _make_use_case(chunker=chunker, embedding=embed)
    result = await uc.execute(_make_request())

    assert result.chunk_count == 3
    assert result.doc_id is not None


# ---------------------------------------------------------------------------
# Re-ingestion
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_reingest_same_hash_replaces_existing():
    """Re-ingestion with same source_hash: old document deleted, new one saved."""
    existing = _make_doc(doc_id="old-doc", source_hash="same-hash")

    doc_repo = AsyncMock()
    doc_repo.find_by_source_hash = AsyncMock(return_value=existing)
    doc_repo.delete = AsyncMock()
    doc_repo.save = AsyncMock()
    doc_repo.update_chunk_count = AsyncMock()

    vector_store = AsyncMock()
    vector_store.upsert = AsyncMock()
    vector_store.delete_by_document_id = AsyncMock()

    uc = _make_use_case(doc_repo=doc_repo, vector_store=vector_store)

    # Content that hashes to same value as existing.source_hash is impractical;
    # we patch sha256 to force a collision
    import hashlib
    with patch.object(hashlib, "sha256") as mock_sha:
        mock_sha.return_value.hexdigest.return_value = "same-hash"
        await uc.execute(_make_request())

    # Old vector store entries deleted
    vector_store.delete_by_document_id.assert_called_once_with("old-doc", "default")
    # Old document record deleted from DB
    doc_repo.delete.assert_called_once_with("old-doc")
    # New document record saved
    doc_repo.save.assert_called_once()


@pytest.mark.asyncio
async def test_new_hash_does_not_delete_existing():
    """Different source_hash → no deletion, fresh ingest."""
    doc_repo = AsyncMock()
    doc_repo.find_by_source_hash = AsyncMock(return_value=None)  # no existing
    doc_repo.delete = AsyncMock()
    doc_repo.save = AsyncMock()
    doc_repo.update_chunk_count = AsyncMock()

    vector_store = AsyncMock()
    vector_store.upsert = AsyncMock()
    vector_store.delete_by_document_id = AsyncMock()

    uc = _make_use_case(doc_repo=doc_repo, vector_store=vector_store)
    await uc.execute(_make_request())

    doc_repo.delete.assert_not_called()
    vector_store.delete_by_document_id.assert_not_called()


# ---------------------------------------------------------------------------
# Graph extraction fire-and-forget
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_graph_extraction_failure_does_not_fail_ingest():
    """Graph client failure must not propagate — ingest should still succeed."""
    graph_client = AsyncMock()
    graph_client.extract_entities = AsyncMock(side_effect=Exception("neo4j down"))

    uc = _make_use_case(graph_client=graph_client)
    result = await uc.execute(_make_request())

    # Ingest succeeds despite graph failure
    assert result.chunk_count >= 1
