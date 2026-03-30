"""
Knowledge Harvest smoke test.

Validates the current knowledge acquisition flow:
  1. /knowledge/page-metadata
  2. /knowledge/batch-scrape

Run:
  python rag-system/tests/test_knowledge_harvest.py

Requires docker compose stack to be up.
"""
import json
import sys
import urllib.error
import urllib.request


KNOWLEDGE_URL = "http://localhost:8006"
TEST_URL = "https://example.com"
TEST_URLS = [
    "https://example.com",
    "https://example.org",
]


def http_post(url: str, payload: dict, timeout: int = 60) -> dict:
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read())


def http_get(url: str, timeout: int = 10) -> dict:
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        return json.loads(resp.read())


def main() -> None:
    try:
        health = http_get(f"{KNOWLEDGE_URL}/health", timeout=5)
        assert health.get("status") == "healthy", health

        metadata = http_post(f"{KNOWLEDGE_URL}/knowledge/page-metadata", {"url": TEST_URL})
        assert metadata.get("url") == TEST_URL
        assert metadata.get("title") is not None

        batch = http_post(
            f"{KNOWLEDGE_URL}/knowledge/batch-scrape",
            {
                "urls": TEST_URLS,
                "namespace": "test-harvest",
                "auto_ingest": False,
                "max_concurrency": 2,
            },
            timeout=120,
        )
        assert batch.get("total") == len(TEST_URLS), batch
        assert batch.get("items"), batch
        print("Knowledge Harvest smoke test passed")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode()[:500]
        print(f"HTTP {exc.code}: {body}")
        sys.exit(1)
    except Exception as exc:
        print(f"ERROR: {type(exc).__name__}: {exc}")
        sys.exit(1)


if __name__ == "__main__":
    main()
