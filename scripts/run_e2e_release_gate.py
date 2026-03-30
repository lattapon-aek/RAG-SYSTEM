"""
Release-gate E2E smoke for the Docker stack.

Runs a minimal but production-relevant flow:
  1. Health checks for core services
  2. ingest -> query -> citations
  3. semantic cache hit
  4. namespace isolation
  5. namespace-scoped delete
  6. quota override set/reset

Usage:
    cd rag-system
    py -3.12 scripts/run_e2e_release_gate.py
"""
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime

RAG_URL = "http://localhost:8000"
INGESTION_URL = "http://localhost:8001"
GRAPH_URL = "http://localhost:8002"
INTELLIGENCE_URL = "http://localhost:8003"
DASHBOARD_URL = "http://localhost:3001"


def _request(method: str, url: str, payload: dict | None = None, timeout: int = 60) -> dict:
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method=method,
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = resp.read()
        if not body:
            return {}
        try:
            return json.loads(body)
        except json.JSONDecodeError:
            return {"raw": body.decode(errors="replace")}


def _get(url: str, timeout: int = 10) -> dict:
    return _request("GET", url, timeout=timeout)


def _post(url: str, payload: dict, timeout: int = 180) -> dict:
    return _request("POST", url, payload=payload, timeout=timeout)


def _patch(url: str, payload: dict, timeout: int = 30) -> dict:
    return _request("PATCH", url, payload=payload, timeout=timeout)


def _delete(url: str, timeout: int = 30) -> tuple[int, dict]:
    req = urllib.request.Request(url, method="DELETE")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read()
            if not body:
                return resp.status, {}
            try:
                return resp.status, json.loads(body)
            except json.JSONDecodeError:
                return resp.status, {"raw": body.decode(errors="replace")}
    except urllib.error.HTTPError as exc:
        body = exc.read()
        if not body:
            return exc.code, {}
        try:
            return exc.code, json.loads(body)
        except json.JSONDecodeError:
            return exc.code, {"raw": body.decode(errors="replace")}


def _print_ok(message: str) -> None:
    print(f"  OK  {message}")


def _print_step(title: str) -> None:
    print(f"\n== {title} ==")


def _wait_for_job(job_id: str, timeout: int = 120) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        status = _get(f"{INGESTION_URL}/ingest/status/{job_id}")
        if status.get("status") == "done":
            return
        if status.get("status") == "failed":
            raise AssertionError(f"ingestion failed: {status}")
        time.sleep(2)
    raise AssertionError(f"job {job_id} timed out")


def _wait_for_document(namespace: str, filename: str, timeout: int = 120) -> str:
    deadline = time.time() + timeout
    while time.time() < deadline:
        docs = _get(f"{RAG_URL}/documents?namespace={urllib.parse.quote(namespace)}")
        for doc in docs:
            if doc.get("filename") == filename:
                return doc["id"]
        time.sleep(2)
    raise AssertionError(f"document {filename} not visible in namespace {namespace}")


def _ingest_text(text: str, filename: str, namespace: str) -> str:
    resp = _post(
        f"{INGESTION_URL}/ingest/text",
        {"text": text, "filename": filename, "namespace": namespace},
    )
    job_id = resp.get("job_id")
    if job_id:
        _wait_for_job(job_id)
        return _wait_for_document(namespace, filename)
    doc_id = resp.get("doc_id") or resp.get("document_id")
    if not doc_id:
        raise AssertionError(f"unexpected ingest response: {resp}")
    return doc_id


def check_health() -> None:
    _print_step("Health")
    services = {
        "rag-service": f"{RAG_URL}/health",
        "ingestion-service": f"{INGESTION_URL}/health",
        "graph-service": f"{GRAPH_URL}/graph/health",
        "intelligence-service": f"{INTELLIGENCE_URL}/health",
        "dashboard": f"{DASHBOARD_URL}/api/health",
    }
    for name, url in services.items():
        data = _get(url, timeout=10)
        assert data.get("status") == "healthy", f"{name} unhealthy: {data}"
        _print_ok(f"{name} healthy")


def run_release_gate() -> None:
    primary_ns = f"release-gate-{int(time.time())}"
    tenant_a = f"{primary_ns}-a"
    tenant_b = f"{primary_ns}-b"
    filename = f"{primary_ns}.txt"
    doc_id = None
    doc_a = None
    doc_b = None
    client_id = f"release-gate-client-{int(time.time())}"

    try:
        check_health()

        _print_step("Ingest -> Query -> Citations")
        doc_id = _ingest_text(
            "The RAG release gate document says the embedding model is bge-m3 and Redis powers semantic cache.",
            filename,
            primary_ns,
        )
        response = _post(
            f"{RAG_URL}/query",
            {
                "query": "What embedding model is used?",
                "namespace": primary_ns,
                "top_k": 5,
                "top_n_rerank": 3,
                "use_cache": False,
                "use_graph": False,
            },
            timeout=240,
        )
        assert response.get("answer"), "query returned empty answer"
        assert response.get("citations"), "query returned no citations"
        assert "nomic" in response["answer"].lower(), response["answer"]
        _print_ok("query returned answer with citations")

        _print_step("Semantic Cache")
        cache_payload = {
            "query": "What system component uses Redis?",
            "namespace": primary_ns,
            "top_k": 3,
            "top_n_rerank": 2,
            "use_cache": True,
            "use_graph": False,
        }
        first = _post(f"{RAG_URL}/query", cache_payload, timeout=240)
        second = _post(f"{RAG_URL}/query", cache_payload, timeout=240)
        assert first.get("from_cache") is False
        assert second.get("from_cache") is True
        _print_ok("second identical query served from cache")

        _print_step("Multi-tenant Isolation")
        doc_a = _ingest_text("Tenant A support code is ALPHA-123.", f"{tenant_a}.txt", tenant_a)
        doc_b = _ingest_text("Tenant B support code is BRAVO-999.", f"{tenant_b}.txt", tenant_b)
        ans_a = _post(
            f"{RAG_URL}/query",
            {"query": "What is the support code?", "namespace": tenant_a, "use_cache": True, "use_graph": False},
            timeout=240,
        )
        _post(
            f"{RAG_URL}/query",
            {"query": "What is the support code?", "namespace": tenant_a, "use_cache": True, "use_graph": False},
            timeout=240,
        )
        ans_b = _post(
            f"{RAG_URL}/query",
            {"query": "What is the support code?", "namespace": tenant_b, "use_cache": True, "use_graph": False},
            timeout=120,
        )
        assert "alpha-123" in ans_a.get("answer", "").lower()
        assert "bravo-999" in ans_b.get("answer", "").lower()
        assert ans_b.get("from_cache") is False
        _print_ok("cache and retrieval isolated by namespace")

        _print_step("Namespace-scoped Delete")
        status, _ = _delete(f"{RAG_URL}/documents/{doc_a}?namespace={urllib.parse.quote(tenant_a)}")
        assert status == 200, f"delete failed with status {status}"
        docs_a = _get(f"{RAG_URL}/documents?namespace={urllib.parse.quote(tenant_a)}")
        docs_b = _get(f"{RAG_URL}/documents?namespace={urllib.parse.quote(tenant_b)}")
        assert all(doc["id"] != doc_a for doc in docs_a)
        assert any(doc["id"] == doc_b for doc in docs_b)
        _print_ok("delete affected only the requested namespace")

        _print_step("Quota Override")
        quota_before = _get(f"{RAG_URL}/quota/{urllib.parse.quote(client_id)}")
        updated = _patch(
            f"{RAG_URL}/quota/{urllib.parse.quote(client_id)}",
            {"daily_limit": 4321},
        )
        assert updated["daily_limit"] == 4321
        assert updated.get("has_override") is True
        reset_status, reset_body = _delete(f"{RAG_URL}/quota/{urllib.parse.quote(client_id)}")
        assert reset_status == 200
        assert reset_body["daily_limit"] == quota_before["daily_limit"]
        assert reset_body.get("override_source") != "redis"
        _print_ok("quota override set and reset successfully")

    finally:
        if doc_id:
            _delete(f"{RAG_URL}/documents/{doc_id}?namespace={urllib.parse.quote(primary_ns)}")
        if doc_a:
            _delete(f"{RAG_URL}/documents/{doc_a}?namespace={urllib.parse.quote(tenant_a)}")
        if doc_b:
            _delete(f"{RAG_URL}/documents/{doc_b}?namespace={urllib.parse.quote(tenant_b)}")


if __name__ == "__main__":
    print(f"\nRelease Gate E2E  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    try:
        run_release_gate()
        print("\nPASS  release-gate smoke completed")
    except Exception as exc:
        print(f"\nFAIL  {type(exc).__name__}: {exc}")
        sys.exit(1)
