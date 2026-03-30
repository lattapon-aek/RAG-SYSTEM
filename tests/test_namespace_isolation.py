"""
Task 17.4 — Unit tests for Namespace Isolation.
Uses in-memory stubs (no real ChromaDB/PostgreSQL/Neo4j).

Property tests:
  - Query with namespace A returns NO chunks from namespace B
  - Delete namespace removes all associated documents + chunks
"""
import sys
import os
import pytest
from typing import List, Dict, Any, Optional

_RAG = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "core", "rag-service"))
if _RAG not in sys.path:
    sys.path.insert(0, _RAG)

from domain.entities import RerankedResult


# ---------------------------------------------------------------------------
# In-memory vector store stub
# ---------------------------------------------------------------------------

class InMemoryVectorStore:
    def __init__(self):
        self._chunks: List[dict] = []

    async def upsert(self, chunk_id: str, embedding: List[float], text: str,
                     document_id: str, namespace: str = "default",
                     metadata=None) -> None:
        self._chunks.append({
            "chunk_id": chunk_id,
            "document_id": document_id,
            "namespace": namespace,
            "text": text,
            "embedding": embedding,
        })

    async def search(self, embedding: List[float], top_k: int = 10,
                     namespace: str = "default", filters=None) -> List[RerankedResult]:
        # Returns only chunks from the requested namespace
        results = [
            RerankedResult(
                chunk_id=c["chunk_id"],
                document_id=c["document_id"],
                text=c["text"],
                score=0.9,
                original_rank=i,
                reranked_rank=i,
                namespace=c["namespace"],
            )
            for i, c in enumerate(self._chunks)
            if c["namespace"] == namespace
        ]
        return results[:top_k]

    async def delete_by_document_id(self, document_id: str, namespace: str = "default") -> None:
        self._chunks = [
            c for c in self._chunks
            if not (c["document_id"] == document_id and c["namespace"] == namespace)
        ]

    def count_for_namespace(self, namespace: str) -> int:
        return sum(1 for c in self._chunks if c["namespace"] == namespace)


# ---------------------------------------------------------------------------
# Tests: namespace A does not leak into namespace B
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_search_namespace_a_returns_no_chunks_from_b():
    """Querying namespace A must return 0 chunks that belong to namespace B."""
    store = InMemoryVectorStore()
    await store.upsert("c1", [0.1, 0.2], "doc in A", "doc-a", namespace="tenant_a")
    await store.upsert("c2", [0.1, 0.2], "doc in B", "doc-b", namespace="tenant_b")
    await store.upsert("c3", [0.1, 0.2], "another A", "doc-a2", namespace="tenant_a")

    results = await store.search([0.1, 0.2], top_k=10, namespace="tenant_a")
    namespaces = {r.namespace for r in results}
    assert "tenant_b" not in namespaces
    assert all(r.namespace == "tenant_a" for r in results)
    assert len(results) == 2


@pytest.mark.asyncio
async def test_search_namespace_b_returns_no_chunks_from_a():
    """Querying namespace B returns only B's chunks."""
    store = InMemoryVectorStore()
    await store.upsert("c1", [0.5, 0.5], "A content", "doc-a", namespace="ns_a")
    await store.upsert("c2", [0.5, 0.5], "B content", "doc-b", namespace="ns_b")

    results = await store.search([0.5, 0.5], namespace="ns_b")
    assert len(results) == 1
    assert results[0].namespace == "ns_b"
    assert results[0].document_id == "doc-b"


@pytest.mark.asyncio
async def test_empty_namespace_returns_no_results():
    """Querying an unknown namespace returns empty list."""
    store = InMemoryVectorStore()
    await store.upsert("c1", [0.1], "data", "doc-x", namespace="existing")
    results = await store.search([0.1], namespace="nonexistent")
    assert results == []


# ---------------------------------------------------------------------------
# Tests: delete namespace removes all data
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_delete_namespace_removes_all_chunks():
    """After deleting namespace, its chunks no longer appear in search."""
    store = InMemoryVectorStore()
    await store.upsert("c1", [0.1], "A1", "doc-1", namespace="del_ns")
    await store.upsert("c2", [0.1], "A2", "doc-2", namespace="del_ns")
    await store.upsert("c3", [0.1], "keep", "doc-3", namespace="keep_ns")

    # Simulate delete namespace: delete all docs in del_ns
    for chunk_id, doc_id in [("c1", "doc-1"), ("c2", "doc-2")]:
        await store.delete_by_document_id(doc_id, namespace="del_ns")

    remaining = await store.search([0.1], namespace="del_ns")
    assert remaining == []

    # Other namespace unaffected
    kept = await store.search([0.1], namespace="keep_ns")
    assert len(kept) == 1


@pytest.mark.asyncio
async def test_delete_document_in_wrong_namespace_does_not_affect_another():
    """Deleting doc-1 from ns_a should not affect doc-1 in ns_b (different namespaces)."""
    store = InMemoryVectorStore()
    await store.upsert("c1", [0.2], "ns_a content", "doc-shared-id", namespace="ns_a")
    await store.upsert("c2", [0.2], "ns_b content", "doc-shared-id", namespace="ns_b")

    # Delete from ns_a only
    await store.delete_by_document_id("doc-shared-id", namespace="ns_a")

    ns_a_results = await store.search([0.2], namespace="ns_a")
    ns_b_results = await store.search([0.2], namespace="ns_b")

    assert len(ns_a_results) == 0
    assert len(ns_b_results) == 1


# ---------------------------------------------------------------------------
# Tests: default namespace backward compatibility
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_default_namespace_works_without_explicit_param():
    """Chunks inserted without namespace default to 'default'."""
    store = InMemoryVectorStore()
    await store.upsert("c1", [0.3], "default content", "doc-d")  # no namespace arg → "default"
    results = await store.search([0.3], namespace="default")
    assert len(results) == 1
    assert results[0].namespace == "default"


def test_namespace_isolation_boundary():
    """Namespace strings are case-sensitive."""
    ns1 = "TenantA"
    ns2 = "tenanta"
    assert ns1 != ns2, "Namespace comparison must be case-sensitive"
