"""
Load a small general-purpose sample corpus into the ingestion service.

This uses the real `/ingest/text` path so the system populates:
  - document metadata in Postgres
  - chunks and embeddings in the vector store
  - graph extraction in the graph service

Usage:
    cd rag-system
    py -3.12 scripts/ingest_sample_corpus.py
    py -3.12 scripts/ingest_sample_corpus.py --namespace sample-basic
    py -3.12 scripts/ingest_sample_corpus.py --data-file scripts/sample_data/basic_corpus.json
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


DEFAULT_INGESTION_URL = "http://localhost:8001"
DEFAULT_RAG_URL = "http://localhost:8000"
DEFAULT_GRAPH_URL = "http://localhost:8002"
DEFAULT_NAMESPACE = "sample-basic"


def guess_validation_query(data_file: Path) -> str:
    name = data_file.name.lower()
    if "graph" in name:
        return "Who reports to Narin Sutham and what does Grafana monitor?"
    return "Who leads Human Resources and which team manages the HR Portal?"


def request_json(method: str, url: str, payload: dict | None = None, timeout: int = 60) -> dict:
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(
        url,
        method=method,
        data=body,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read()
        if not raw:
            return {}
        return json.loads(raw)


def get_json(url: str, timeout: int = 30) -> dict | list:
    return request_json("GET", url, timeout=timeout)


def post_json(url: str, payload: dict, timeout: int = 120) -> dict:
    return request_json("POST", url, payload=payload, timeout=timeout)


def wait_for_job(ingestion_url: str, job_id: str, timeout: int = 180) -> dict:
    deadline = time.time() + timeout
    last_status: dict = {}
    while time.time() < deadline:
        last_status = get_json(f"{ingestion_url}/ingest/status/{job_id}")
        status = last_status.get("status")
        if status == "done":
            return last_status
        if status == "failed":
            raise RuntimeError(f"job {job_id} failed: {last_status}")
        time.sleep(2)
    raise TimeoutError(f"job {job_id} timed out: {last_status}")


def wait_for_document(rag_url: str, namespace: str, filename: str, timeout: int = 120) -> dict:
    deadline = time.time() + timeout
    encoded_ns = urllib.parse.quote(namespace)
    while time.time() < deadline:
        docs = get_json(f"{rag_url}/documents?namespace={encoded_ns}")
        for doc in docs:
            if doc.get("filename") == filename:
                return doc
        time.sleep(2)
    raise TimeoutError(f"document {filename} did not appear in namespace {namespace}")


def wait_for_graph(graph_url: str, namespace: str, timeout: int = 60) -> dict | None:
    deadline = time.time() + timeout
    sample_payloads = [
        {"query_text": "Who leads Human Resources?", "entity_names": ["Ploy Anan"], "namespace": namespace},
        {"query_text": "What systems are managed by IT Operations?", "entity_names": ["IT Operations"], "namespace": namespace},
        {"query_text": "Which system had a login incident?", "entity_names": ["Support Desk"], "namespace": namespace},
    ]
    while time.time() < deadline:
        for payload in sample_payloads:
            try:
                result = post_json(f"{graph_url}/graph/query", payload, timeout=60)
            except urllib.error.HTTPError:
                continue
            if result.get("entities") or result.get("relations") or result.get("context_text"):
                return result
        time.sleep(3)
    return None


def load_corpus(data_file: Path) -> list[dict]:
    items = json.loads(data_file.read_text(encoding="utf-8"))
    if not isinstance(items, list) or not items:
        raise ValueError(f"expected non-empty list in {data_file}")
    required = {"filename", "text"}
    for index, item in enumerate(items, start=1):
        if not isinstance(item, dict) or not required.issubset(item):
            raise ValueError(f"invalid corpus item #{index}: {item!r}")
    return items


def print_step(message: str) -> None:
    print(f"\n== {message} ==")


def print_ok(message: str) -> None:
    print(f"  OK  {message}")


def parse_args() -> argparse.Namespace:
    default_file = Path(__file__).with_name("sample_data") / "basic_corpus.json"
    parser = argparse.ArgumentParser(description="Ingest a small sample corpus into the stack")
    parser.add_argument("--namespace", default=DEFAULT_NAMESPACE, help="Target namespace")
    parser.add_argument("--ingestion-url", default=DEFAULT_INGESTION_URL, help="Ingestion service base URL")
    parser.add_argument("--rag-url", default=DEFAULT_RAG_URL, help="RAG service base URL")
    parser.add_argument("--graph-url", default=DEFAULT_GRAPH_URL, help="Graph service base URL")
    parser.add_argument("--data-file", default=str(default_file), help="JSON corpus file")
    parser.add_argument("--validation-query", default=None, help="Query used to validate retrieval after ingest")
    parser.add_argument("--skip-graph-check", action="store_true", help="Skip graph verification")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    data_file = Path(args.data_file)
    corpus = load_corpus(data_file)
    validation_query = args.validation_query or guess_validation_query(data_file)

    print_step("Health")
    for name, url in (
        ("ingestion-service", f"{args.ingestion_url}/health"),
        ("rag-service", f"{args.rag_url}/health"),
        ("graph-service", f"{args.graph_url}/graph/health"),
    ):
        data = get_json(url)
        if data.get("status") != "healthy":
            raise RuntimeError(f"{name} unhealthy: {data}")
        print_ok(f"{name} healthy")

    print_step(f"Ingest corpus into namespace '{args.namespace}'")
    ingested_docs: list[dict] = []
    for item in corpus:
        payload = {
            "text": item["text"],
            "filename": item["filename"],
            "namespace": args.namespace,
            "content_source": item.get("content_source", "upload"),
            "source_url": item.get("source_url"),
            "expires_in_days": item.get("expires_in_days"),
        }
        response = post_json(f"{args.ingestion_url}/ingest/text", payload, timeout=120)
        job_id = response.get("job_id")
        if not job_id:
            raise RuntimeError(f"unexpected ingest response for {item['filename']}: {response}")
        wait_for_job(args.ingestion_url, job_id)
        doc = wait_for_document(args.rag_url, args.namespace, item["filename"])
        ingested_docs.append(doc)
        print_ok(f"{item['filename']} -> {doc['id']} ({doc.get('chunk_count', '?')} chunks)")

    print_step("Verify vector-side documents")
    docs = get_json(f"{args.rag_url}/documents?namespace={urllib.parse.quote(args.namespace)}")
    print_ok(f"{len(docs)} documents visible in namespace {args.namespace}")

    sample_query = {
        "query": validation_query,
        "namespace": args.namespace,
        "top_k": 5,
        "top_n_rerank": 3,
        "use_cache": False,
        "use_graph": True,
    }
    query_result = post_json(f"{args.rag_url}/query", sample_query, timeout=180)
    if not query_result.get("answer"):
        raise RuntimeError("sample vector query returned no answer")
    print_ok("sample retrieval query returned an answer")
    if query_result.get("citations"):
        print_ok(f"query returned {len(query_result['citations'])} citations")

    if not args.skip_graph_check:
        print_step("Verify graph-side extraction")
        graph_result = wait_for_graph(args.graph_url, args.namespace)
        if graph_result:
            entity_count = len(graph_result.get("entities", []))
            relation_count = len(graph_result.get("relations", []))
            print_ok(f"graph query returned {entity_count} entities and {relation_count} relations")
        else:
            print("  WARN graph verification did not find entities yet; extraction may still be catching up")

    print_step("Done")
    print(f"Namespace: {args.namespace}")
    print(f"Validation query: {validation_query}")
    print("Suggested queries:")
    if "graph" in data_file.name.lower():
        print("  - Who reports to Narin Sutham?")
        print("  - What does Grafana monitor?")
        print("  - Which team pays Siam Supplies?")
        print("  - Who approves Payment Exception?")
    else:
        print("  - Who leads Human Resources?")
        print("  - Which systems are managed by IT Operations?")
        print("  - What happened on 2026-02-14?")
        print("  - Which team processes vendor payments?")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise
