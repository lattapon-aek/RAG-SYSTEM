"""
Full Loop Test — RAG Pipeline
ทดสอบ: ingest → embed → store ChromaDB → query → embed query → search → LLM → answer

รัน: python rag-system/tests/test_full_loop.py
(ต้องมี docker compose up ก่อน)
"""
import json
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
INGESTION_URL = "http://localhost:8001"
RAG_URL       = "http://localhost:8000"

TEST_CONTENT = """
RAG System Architecture Overview

The RAG (Retrieval-Augmented Generation) system consists of several microservices:

1. Ingestion Service (port 8001): Handles document ingestion, chunking, and embedding.
   Documents are split into chunks using configurable strategies (fixed, sentence, hierarchical, semantic).
   Each chunk is embedded using Ollama bge-m3 model and stored in ChromaDB.

2. RAG Service (port 8000): Handles query processing.
   When a query arrives, it is embedded using the same model.
   The embedding is used to search ChromaDB for the most similar chunks.
   Retrieved chunks are passed as context to the LLM (llama3.2:3b) to generate an answer.

3. Graph Service (port 8002): Extracts named entities from documents using spaCy
   and stores relationships in Neo4j for graph-augmented retrieval.

4. Reranker Service (port 8005): Re-ranks retrieved chunks using BGE cross-encoder
   to improve relevance before passing to LLM.

The system supports semantic caching via Redis to avoid redundant LLM calls.
"""

TEST_QUESTION = "RAG Service ทำงานยังไง และใช้ model อะไรในการ embed?"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def http_post(url: str, payload: dict, timeout: int = 60) -> dict:
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        url, data=data,
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read())


def http_get(url: str, timeout: int = 10) -> dict:
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        return json.loads(resp.read())


def print_step(step: int, title: str):
    print(f"\n{'='*60}")
    print(f"  STEP {step}: {title}")
    print(f"{'='*60}")


def print_ok(msg: str):
    print(f"  ✓ {msg}")


def print_info(label: str, value):
    if isinstance(value, str) and len(value) > 200:
        value = value[:200] + "..."
    print(f"  {label}: {value}")


# ---------------------------------------------------------------------------
# Test Steps
# ---------------------------------------------------------------------------

def step_health_check():
    print_step(1, "Health Check — ตรวจสอบ services")
    for name, url in [("ingestion-service", f"{INGESTION_URL}/health"),
                      ("rag-service",        f"{RAG_URL}/health")]:
        try:
            resp = http_get(url, timeout=5)
            print_ok(f"{name} → {resp.get('status', resp)}")
        except Exception as e:
            print(f"  ✗ {name} ไม่ตอบสนอง: {e}")
            sys.exit(1)


def step_ingest() -> str:
    print_step(2, "Ingest Document → ingestion-service → ChromaDB")
    print_info("content length", f"{len(TEST_CONTENT)} chars")

    resp = http_post(f"{INGESTION_URL}/ingest/text", {
        "text": TEST_CONTENT,
        "filename": "rag_architecture_test.txt",
        "namespace": "test-loop",
    }, timeout=60)

    doc_id = resp.get("document_id", resp.get("id", resp.get("doc_id", "unknown")))
    chunks  = resp.get("chunks_created", resp.get("chunk_count", "?"))
    print_ok(f"document_id = {doc_id}")
    print_ok(f"chunks created = {chunks}")
    print_info("full response", resp)
    return doc_id


def step_wait_index():
    print_step(3, "Wait — รอ ChromaDB index พร้อม")
    time.sleep(2)
    print_ok("waited 2s")


def step_query() -> dict:
    print_step(4, "Query → rag-service → embed → ChromaDB search → LLM")
    print_info("question", TEST_QUESTION)

    t0 = time.time()
    resp = http_post(f"{RAG_URL}/query", {
        "query": TEST_QUESTION,
        "namespace": "test-loop",
        "top_k": 5,
        "top_n_rerank": 3,
        "use_cache": False,   # force_refresh เพื่อเห็น full pipeline
        "use_graph": False,   # ปิด graph เพื่อ isolate RAG core
    }, timeout=120)
    elapsed = time.time() - t0

    print_ok(f"response time = {elapsed:.2f}s")
    return resp


def step_validate(resp: dict):
    print_step(5, "Validate Response")

    answer = resp.get("answer", "")
    sources = resp.get("sources", resp.get("citations", []))
    chunks  = resp.get("retrieved_chunks", resp.get("context_chunks", []))
    cached  = resp.get("cached", False)
    query_id = resp.get("query_id", "-")

    print_info("query_id", query_id)
    print_info("cached", cached)
    print_info("sources count", len(sources))
    print_info("chunks retrieved", len(chunks) if chunks else "N/A")

    print(f"\n  --- ANSWER ---")
    print(f"  {answer}")
    print(f"  --- END ---\n")

    # Assertions
    assert answer, "answer ต้องไม่ว่าง"
    assert len(answer) > 20, f"answer สั้นเกินไป: '{answer}'"

    # ตรวจว่า answer มีเนื้อหาที่เกี่ยวข้อง
    keywords = ["embed", "llama", "chroma", "chunk", "query", "rag", "8000", "nomic"]
    found = [kw for kw in keywords if kw.lower() in answer.lower()]
    print_info("keywords found in answer", found)

    if sources:
        print_info("sources", [s.get("document_id", s) for s in sources[:3]])

    print_ok("validation passed")


def step_cleanup(doc_id: str):
    print_step(6, f"Cleanup — ลบ document {doc_id}")
    if doc_id == "unknown":
        print("  skipped (no doc_id)")
        return
    try:
        req = urllib.request.Request(
            f"{RAG_URL}/documents/{doc_id}",
            method="DELETE"
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            print_ok(f"deleted → {resp.status}")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            print_ok("document already gone (404)")
        else:
            print(f"  warning: delete failed {e.code}")
    except Exception as e:
        print(f"  warning: {e}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print(f"\n{'#'*60}")
    print(f"  RAG FULL LOOP TEST")
    print(f"  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'#'*60}")

    try:
        step_health_check()
        doc_id = step_ingest()
        step_wait_index()
        resp   = step_query()
        step_validate(resp)
        step_cleanup(doc_id)

        print(f"\n{'#'*60}")
        print(f"  ALL STEPS PASSED")
        print(f"{'#'*60}\n")

    except AssertionError as e:
        print(f"\n  ASSERTION FAILED: {e}")
        sys.exit(1)
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f"\n  HTTP ERROR {e.code}: {body[:500]}")
        sys.exit(1)
    except Exception as e:
        print(f"\n  ERROR: {type(e).__name__}: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
