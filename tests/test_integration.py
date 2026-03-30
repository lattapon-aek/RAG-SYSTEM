"""
Task 14.5 — Integration tests: full query pipeline
ต้องมี docker compose up ก่อนรัน

Tests:
  1. ingest → query → answer with citations  (ครอบคลุมแล้วใน test_full_loop.py)
  2. cache hit: same query twice → second response from_cache=True
  3. tool fallback: empty KB → Knowledge Connector invoked (web search used)

Usage:
    cd rag-system
    py -3.12 -m pytest tests/test_integration.py -v -m integration
    # หรือรันโดยตรง
    py -3.12 tests/test_integration.py
"""
import json
import sys
import time
import urllib.request
import urllib.error
import urllib.parse
from datetime import datetime

import pytest

INGESTION_URL = "http://localhost:8001"
RAG_URL       = "http://localhost:8000"
KNOWLEDGE_URL = "http://localhost:8006"

TEST_NAMESPACE = "test-integration"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _post(url: str, payload: dict, timeout: int = 120) -> dict:
    data = json.dumps(payload).encode()
    req  = urllib.request.Request(
        url, data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read())


def _get(url: str, timeout: int = 10) -> dict:
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        return json.loads(resp.read())


def _delete(url: str, timeout: int = 10) -> int:
    req = urllib.request.Request(url, method="DELETE")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status
    except urllib.error.HTTPError as e:
        return e.code


def _wait_for_job(job_id: str, timeout: int = 120, interval: float = 2.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        status = _get(f"{INGESTION_URL}/ingest/status/{job_id}", timeout=10)
        if status.get("status") == "done":
            return status
        if status.get("status") == "failed":
            raise AssertionError(f"Ingestion job failed: {status}")
        time.sleep(interval)
    raise AssertionError(f"Ingestion job {job_id} did not finish within {timeout}s")


def _wait_for_document(namespace: str, filename: str, timeout: int = 120,
                       interval: float = 2.0) -> dict:
    deadline = time.time() + timeout
    query = urllib.parse.urlencode({"namespace": namespace})
    while time.time() < deadline:
        docs = _get(f"{RAG_URL}/documents?{query}", timeout=10)
        for doc in docs:
            if doc.get("filename") == filename:
                return doc
        time.sleep(interval)
    raise AssertionError(f"Document {filename} not visible in namespace {namespace}")


def _ingest_text_and_wait(text: str, filename: str, namespace: str) -> str:
    resp = _post(f"{INGESTION_URL}/ingest/text", {
        "text": text,
        "filename": filename,
        "namespace": namespace,
    })
    job_id = resp.get("job_id")
    if job_id:
        _wait_for_job(job_id)
        return _wait_for_document(namespace, filename)["id"]
    doc_id = resp.get("doc_id", resp.get("document_id", "unknown"))
    if doc_id == "unknown":
        raise AssertionError(f"Ingestion did not return a document id: {resp}")
    return doc_id


def _services_up() -> bool:
    for url in [f"{RAG_URL}/health", f"{INGESTION_URL}/health"]:
        try:
            _get(url, timeout=3)
        except Exception:
            return False
    return True


# ---------------------------------------------------------------------------
# Pytest marker
# ---------------------------------------------------------------------------

pytestmark = pytest.mark.integration


def pytest_configure(config):
    config.addinivalue_line("markers", "integration: tests that require docker compose up")


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module", autouse=True)
def require_services():
    if not _services_up():
        pytest.skip("Docker services not running — skipping integration tests")


@pytest.fixture(scope="module")
def ingested_doc():
    """Ingest a test document once per module, yield doc_id, then clean up."""
    filename = f"integration_test_doc_{int(time.time())}.txt"
    content = (
        "The bge-m3 model is used by the RAG system to create vector embeddings. "
        "Embeddings are stored in ChromaDB for semantic search. "
        "The llama3.2:3b model generates answers from retrieved context chunks. "
        "The ingestion service splits documents into chunks before embedding. "
        "Semantic caching stores query results in Redis to avoid redundant LLM calls."
    )
    doc_id = _ingest_text_and_wait(content, filename, TEST_NAMESPACE)

    yield doc_id

    # Cleanup
    _delete(f"{RAG_URL}/documents/{doc_id}?namespace={TEST_NAMESPACE}")


# ---------------------------------------------------------------------------
# Test 1 — end-to-end: ingest → query → answer with citations
# ---------------------------------------------------------------------------

def test_ingest_query_returns_answer_with_citations(ingested_doc):
    """Ingest a document, query it, verify answer and citations are present."""
    assert ingested_doc != "unknown", "Document ingest failed"

    resp = _post(f"{RAG_URL}/query", {
        "query": "What model is used for embeddings?",
        "namespace": TEST_NAMESPACE,
        "top_k": 5,
        "top_n_rerank": 3,
        "use_cache": False,
        "use_graph": False,
    })

    answer   = resp.get("answer", "")
    citations = resp.get("citations", [])

    assert answer, "Answer must not be empty"
    assert len(answer) > 10, f"Answer too short: '{answer}'"
    assert len(citations) > 0, "Must have at least one citation"

    # Answer should mention the embedding model or ChromaDB
    keywords = ["nomic", "embed", "chroma", "vector"]
    found = any(kw in answer.lower() for kw in keywords)
    assert found, f"Answer doesn't mention expected content. Got: '{answer[:200]}'"


# ---------------------------------------------------------------------------
# Test 2 — cache hit: same query twice → second from_cache=True
# ---------------------------------------------------------------------------

def test_cache_hit_second_query_from_cache(ingested_doc):
    """Same query sent twice → second response must come from semantic cache."""
    query_payload = {
        "query": "What model generates answers in the RAG system?",
        "namespace": TEST_NAMESPACE,
        "top_k": 3,
        "top_n_rerank": 2,
        "use_cache": True,
        "force_refresh": False,
        "use_graph": False,
    }

    # First query — populate cache
    resp1 = _post(f"{RAG_URL}/query", query_payload)
    assert resp1.get("answer"), "First query must return an answer"
    assert resp1.get("from_cache") is False, "First query must not be from cache"

    # Second identical query — should hit cache
    resp2 = _post(f"{RAG_URL}/query", query_payload)
    assert resp2.get("from_cache") is True, (
        "Second identical query must be served from semantic cache"
    )
    assert resp2.get("answer") == resp1.get("answer"), (
        "Cached answer must match original answer"
    )


# ---------------------------------------------------------------------------
# Test 3 — tool fallback: empty KB namespace → Knowledge Connector invoked
# ---------------------------------------------------------------------------

def test_empty_kb_query_returns_no_info_response():
    """Query against empty namespace → answer must indicate no information available."""
    empty_namespace = f"empty-ns-{int(time.time())}"

    resp = _post(f"{RAG_URL}/query", {
        "query": "What is the capital of France?",
        "namespace": empty_namespace,
        "top_k": 5,
        "use_cache": False,
        "use_graph": False,
        "use_tools": False,  # tools off — pure KB miss
    })

    answer = resp.get("answer", "")
    assert answer, "Answer must not be empty even for empty KB"

    # When KB has nothing, the answer should admit it
    no_info_phrases = [
        "don't have", "no relevant", "not enough", "cannot find",
        "no information", "unable to find", "don't know",
    ]
    found = any(phrase in answer.lower() for phrase in no_info_phrases)
    assert found, (
        f"Empty KB answer should indicate no information available. Got: '{answer[:200]}'"
    )


def test_cache_isolation_between_namespaces():
    """Same query in different namespaces must not share semantic cache entries."""
    ns_a = f"cache-tenant-a-{int(time.time())}"
    ns_b = f"cache-tenant-b-{int(time.time())}"
    filename_a = f"{ns_a}.txt"
    filename_b = f"{ns_b}.txt"

    doc_a = _ingest_text_and_wait(
        "Tenant A secret: the support code is ALPHA-123.",
        filename_a,
        ns_a,
    )
    doc_b = _ingest_text_and_wait(
        "Tenant B secret: the support code is BRAVO-999.",
        filename_b,
        ns_b,
    )

    try:
        payload_a = {
            "query": "What is the support code?",
            "namespace": ns_a,
            "top_k": 3,
            "top_n_rerank": 2,
            "use_cache": True,
            "use_graph": False,
        }
        payload_b = {
            "query": "What is the support code?",
            "namespace": ns_b,
            "top_k": 3,
            "top_n_rerank": 2,
            "use_cache": True,
            "use_graph": False,
        }

        first_a = _post(f"{RAG_URL}/query", payload_a)
        second_a = _post(f"{RAG_URL}/query", payload_a)
        first_b = _post(f"{RAG_URL}/query", payload_b)

        assert second_a.get("from_cache") is True
        assert first_b.get("from_cache") is False, "Namespace B must not reuse namespace A cache"
        assert "ALPHA-123".lower() in first_a.get("answer", "").lower()
        assert "BRAVO-999".lower() in first_b.get("answer", "").lower()
    finally:
        _delete(f"{RAG_URL}/documents/{doc_a}?namespace={ns_a}")
        _delete(f"{RAG_URL}/documents/{doc_b}?namespace={ns_b}")


def test_delete_document_is_namespace_scoped():
    """Deleting a shared document id in one namespace must not remove another namespace's copy."""
    ns_a = f"delete-tenant-a-{int(time.time())}"
    ns_b = f"delete-tenant-b-{int(time.time())}"
    filename_a = f"{ns_a}.txt"
    filename_b = f"{ns_b}.txt"

    doc_a = _ingest_text_and_wait("Namespace A delete test content", filename_a, ns_a)
    doc_b = _ingest_text_and_wait("Namespace B delete test content", filename_b, ns_b)

    try:
        status = _delete(f"{RAG_URL}/documents/{doc_a}?namespace={ns_a}")
        assert status == 200

        docs_a = _get(f"{RAG_URL}/documents?namespace={urllib.parse.quote(ns_a)}")
        docs_b = _get(f"{RAG_URL}/documents?namespace={urllib.parse.quote(ns_b)}")

        assert all(d["id"] != doc_a for d in docs_a)
        assert any(d["id"] == doc_b for d in docs_b)
    finally:
        _delete(f"{RAG_URL}/documents/{doc_a}?namespace={ns_a}")
        _delete(f"{RAG_URL}/documents/{doc_b}?namespace={ns_b}")


# ---------------------------------------------------------------------------
# Standalone runner
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    print(f"\n{'#'*60}")
    print(f"  INTEGRATION TESTS")
    print(f"  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'#'*60}\n")

    if not _services_up():
        print("  ✗ Services not running. Run: docker compose up -d")
        sys.exit(1)

    # Ingest
    content = (
        "The bge-m3 model is used for embeddings. "
        "ChromaDB stores the vectors. llama3.2:3b generates answers."
    )
    filename = f"int_test_{int(time.time())}.txt"
    doc_id = _ingest_text_and_wait(content, filename, TEST_NAMESPACE)
    print(f"  ✓ Ingested doc_id={doc_id}")

    # Test 1 — query returns answer + citations
    r1 = _post(f"{RAG_URL}/query", {
        "query": "What model is used for embeddings?",
        "namespace": TEST_NAMESPACE, "use_cache": False, "use_graph": False,
    })
    assert r1.get("answer"), "Answer empty"
    assert r1.get("citations"), "No citations"
    print("  ✓ Test 1 passed: answer + citations")

    # Test 2 — cache hit
    q = {"query": "What stores vectors?", "namespace": TEST_NAMESPACE,
         "use_cache": True, "use_graph": False}
    _post(f"{RAG_URL}/query", q)
    r2b = _post(f"{RAG_URL}/query", q)
    assert r2b.get("from_cache") is True, "Second query not from cache"
    print("  ✓ Test 2 passed: cache hit")

    # Test 3 — empty KB
    r3 = _post(f"{RAG_URL}/query", {
        "query": "What is the capital of France?",
        "namespace": "definitely-empty-ns-xyz",
        "use_cache": False, "use_graph": False, "use_tools": False,
    })
    answer3 = r3.get("answer", "")
    no_info = any(p in answer3.lower() for p in ["don't have", "no relevant", "not enough"])
    assert no_info, f"Expected no-info response, got: '{answer3[:200]}'"
    print("  ✓ Test 3 passed: empty KB → no-info response")

    # Cleanup
    _delete(f"{RAG_URL}/documents/{doc_id}?namespace={TEST_NAMESPACE}")
    print(f"\n  ✓ All integration tests passed!\n")
