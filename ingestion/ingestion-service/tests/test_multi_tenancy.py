import os
import sys
from unittest.mock import AsyncMock

import pytest

_INGESTION = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _INGESTION not in sys.path:
    sys.path.insert(0, _INGESTION)

from application.ingest_document_use_case import IngestDocumentUseCase, IngestRequest
from domain.entities import Document, Chunk


class _ParserStub:
    async def parse(self, content: bytes, filename: str, mime_type: str):
        return (
            content.decode("utf-8"),
            Document(
                id="doc-new",
                filename=filename,
                mime_type=mime_type,
            ),
        )


class _ChunkerStub:
    async def chunk(self, text: str, document_id: str, namespace: str = "default"):
        return [
            Chunk(
                id="chunk-1",
                document_id=document_id,
                text=text,
                token_count=len(text.split()),
                sequence_index=0,
                namespace=namespace,
            )
        ]


@pytest.mark.asyncio
async def test_duplicate_hash_check_is_namespace_scoped():
    repo = AsyncMock()
    repo.find_by_source_hash = AsyncMock(return_value=None)
    repo.save = AsyncMock(return_value=None)
    repo.update_chunk_count = AsyncMock(return_value=None)

    vector_store = AsyncMock()
    vector_store.upsert = AsyncMock(return_value=None)

    graph_client = AsyncMock()
    graph_client.extract_entities = AsyncMock(return_value=None)

    embed = AsyncMock()
    embed.embed_batch = AsyncMock(return_value=[[0.1, 0.2]])

    use_case = IngestDocumentUseCase(
        parser=_ParserStub(),
        chunker=_ChunkerStub(),
        embedding_service=embed,
        vector_store=vector_store,
        document_repository=repo,
        graph_service_client=graph_client,
    )

    req = IngestRequest(
        content=b"same content",
        filename="tenant-a.txt",
        mime_type="text/plain",
        namespace="tenant-a",
    )
    await use_case.execute(req)

    repo.find_by_source_hash.assert_awaited_once()
    _, kwargs = repo.find_by_source_hash.await_args
    assert kwargs["namespace"] == "tenant-a"


@pytest.mark.asyncio
async def test_same_source_hash_in_other_namespace_does_not_skip_ingest():
    existing = Document(
        id="doc-tenant-b",
        filename="dup.txt",
        mime_type="text/plain",
        source_hash="hash",
        namespace="tenant-b",
        chunk_count=4,
    )
    repo = AsyncMock()
    repo.find_by_source_hash = AsyncMock(return_value=None)
    repo.save = AsyncMock(return_value=None)
    repo.update_chunk_count = AsyncMock(return_value=None)

    vector_store = AsyncMock()
    vector_store.upsert = AsyncMock(return_value=None)

    graph_client = AsyncMock()
    graph_client.extract_entities = AsyncMock(return_value=None)

    embed = AsyncMock()
    embed.embed_batch = AsyncMock(return_value=[[0.1, 0.2]])

    use_case = IngestDocumentUseCase(
        parser=_ParserStub(),
        chunker=_ChunkerStub(),
        embedding_service=embed,
        vector_store=vector_store,
        document_repository=repo,
        graph_service_client=graph_client,
    )

    repo.find_by_source_hash.return_value = None
    result = await use_case.execute(
        IngestRequest(
            content=b"same content",
            filename="tenant-a.txt",
            mime_type="text/plain",
            namespace="tenant-a",
        )
    )

    assert result.doc_id == "doc-new"
    repo.save.assert_awaited_once()
    vector_store.upsert.assert_awaited_once()
    assert existing.namespace == "tenant-b"


@pytest.mark.asyncio
async def test_graph_extraction_uses_request_namespace():
    repo = AsyncMock()
    repo.find_by_source_hash = AsyncMock(return_value=None)
    repo.save = AsyncMock(return_value=None)
    repo.update_chunk_count = AsyncMock(return_value=None)

    vector_store = AsyncMock()
    vector_store.upsert = AsyncMock(return_value=None)

    graph_client = AsyncMock()
    graph_client.extract_entities = AsyncMock(return_value=None)

    embed = AsyncMock()
    embed.embed_batch = AsyncMock(return_value=[[0.1, 0.2]])

    use_case = IngestDocumentUseCase(
        parser=_ParserStub(),
        chunker=_ChunkerStub(),
        embedding_service=embed,
        vector_store=vector_store,
        document_repository=repo,
        graph_service_client=graph_client,
    )

    await use_case._trigger_graph_extraction("hello", "doc-123", "tenant-a")
    graph_client.extract_entities.assert_awaited_once_with(
        "hello", "doc-123", namespace="tenant-a"
    )


@pytest.mark.asyncio
async def test_duplicate_document_still_rebuilds_graph_before_success():
    existing = Document(
        id="doc-existing",
        filename="dup.txt",
        mime_type="text/plain",
        source_hash="hash",
        namespace="tenant-a",
        chunk_count=7,
    )

    repo = AsyncMock()
    repo.find_by_source_hash = AsyncMock(return_value=existing)
    repo.save = AsyncMock(return_value=None)
    repo.update_chunk_count = AsyncMock(return_value=None)

    vector_store = AsyncMock()
    vector_store.upsert = AsyncMock(return_value=None)

    graph_client = AsyncMock()
    graph_client.extract_entities = AsyncMock(return_value=None)

    embed = AsyncMock()
    embed.embed_batch = AsyncMock(return_value=[[0.1, 0.2]])

    use_case = IngestDocumentUseCase(
        parser=_ParserStub(),
        chunker=_ChunkerStub(),
        embedding_service=embed,
        vector_store=vector_store,
        document_repository=repo,
        graph_service_client=graph_client,
    )

    result = await use_case.execute(
        IngestRequest(
            content=b"same content",
            filename="tenant-a.txt",
            mime_type="text/plain",
            namespace="tenant-a",
        )
    )

    assert result.doc_id == "doc-existing"
    assert result.chunk_count == 7
    vector_store.upsert.assert_not_awaited()
    repo.save.assert_not_awaited()
    graph_client.extract_entities.assert_awaited_once_with(
        "same content", "doc-existing", namespace="tenant-a"
    )
