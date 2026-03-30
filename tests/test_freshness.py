"""
Task 12.3 — Property tests for Temporal Knowledge / Freshness Scoring.

Property 9: Freshness score monotonicity
  - A document ingested more recently must always receive a higher freshness-adjusted
    score than an older document with the same base semantic score (when decay_weight > 0).
"""
import sys
import os

_RAG = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "core", "rag-service"))
if _RAG not in sys.path:
    sys.path.insert(0, _RAG)

from datetime import datetime, timezone, timedelta
from domain.entities import RerankedResult
from application.freshness_scorer import apply_freshness


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_result(chunk_id: str, score: float, ingested_days_ago: float,
                 expires_days_from_now: float | None = None) -> RerankedResult:
    now = datetime.now(timezone.utc)
    ingested_at = now - timedelta(days=ingested_days_ago)
    meta = {"ingested_at": ingested_at.isoformat()}
    if expires_days_from_now is not None:
        expires_at = now + timedelta(days=expires_days_from_now)
        meta["expires_at"] = expires_at.isoformat()
    return RerankedResult(
        chunk_id=chunk_id, document_id="doc", text="text",
        score=score, original_rank=0, reranked_rank=0, metadata=meta,
    )


def _make_expired(chunk_id: str, score: float) -> RerankedResult:
    now = datetime.now(timezone.utc)
    past = now - timedelta(days=1)
    meta = {
        "ingested_at": (now - timedelta(days=10)).isoformat(),
        "expires_at": past.isoformat(),
    }
    return RerankedResult(
        chunk_id=chunk_id, document_id="doc", text="text",
        score=score, original_rank=0, reranked_rank=0, metadata=meta,
    )


# ---------------------------------------------------------------------------
# Property 9: Freshness monotonicity
# ---------------------------------------------------------------------------

def test_fresher_doc_scores_higher_than_older_same_base_score():
    """Newer ingestion_at → higher adjusted score when decay_weight > 0."""
    newer = _make_result("new", score=0.8, ingested_days_ago=1)
    older = _make_result("old", score=0.8, ingested_days_ago=180)

    results = apply_freshness([newer, older], decay_weight=0.1)
    ids = [r.chunk_id for r in results]
    assert ids[0] == "new", "Fresher doc must rank first"
    assert results[0].score > results[1].score


def test_freshness_monotonic_across_ages():
    """Strictly decreasing age → strictly decreasing score (same base score)."""
    ages = [1, 30, 90, 180, 365]
    chunks = [_make_result(f"c{a}", score=0.7, ingested_days_ago=a) for a in ages]
    results = apply_freshness(chunks, decay_weight=0.1)
    scores = [r.score for r in results]
    for i in range(len(scores) - 1):
        assert scores[i] >= scores[i + 1], f"Score should be non-increasing: {scores}"


def test_zero_decay_weight_preserves_original_order():
    """When decay_weight=0, freshness has no effect — scores unchanged."""
    newer = _make_result("new", score=0.5, ingested_days_ago=1)
    older = _make_result("old", score=0.9, ingested_days_ago=300)

    results = apply_freshness([newer, older], decay_weight=0.0)
    assert results[0].chunk_id == "old"  # higher base score wins
    assert results[0].score == 0.9


def test_expired_chunks_filtered_out():
    """Chunks past expires_at are excluded from results."""
    good = _make_result("good", score=0.8, ingested_days_ago=5, expires_days_from_now=10)
    expired = _make_expired("expired", score=0.99)

    results = apply_freshness([good, expired])
    ids = [r.chunk_id for r in results]
    assert "expired" not in ids
    assert "good" in ids


def test_no_expires_at_never_filtered():
    """Chunks without expires_at metadata are never excluded."""
    r = RerankedResult(
        chunk_id="c", document_id="doc", text="t",
        score=0.7, original_rank=0, reranked_rank=0,
        metadata={"ingested_at": datetime.now(timezone.utc).isoformat()},
    )
    results = apply_freshness([r])
    assert len(results) == 1


def test_empty_results_returns_empty():
    assert apply_freshness([]) == []


def test_freshness_score_bounded():
    """Adjusted scores must stay within [0, 1]."""
    chunks = [
        _make_result("brand_new", score=1.0, ingested_days_ago=0),
        _make_result("very_old", score=0.0, ingested_days_ago=1000),
    ]
    results = apply_freshness(chunks, decay_weight=0.5)
    for r in results:
        assert 0.0 <= r.score <= 1.0, f"Score out of range: {r.score}"


def test_freshness_not_applied_without_ingested_at():
    """Chunks missing ingested_at metadata retain their original score."""
    r = RerankedResult(
        chunk_id="c", document_id="doc", text="t",
        score=0.75, original_rank=0, reranked_rank=0, metadata={},
    )
    results = apply_freshness([r], decay_weight=0.1)
    assert len(results) == 1
    assert results[0].score == 0.75


def test_ttl_decay_penalizes_expiring_content():
    """Time-bounded content should decay as it approaches expires_at."""
    now = datetime.now(timezone.utc)
    fresher_ttl = RerankedResult(
        chunk_id="fresh-ttl", document_id="doc", text="fresh",
        score=0.8, original_rank=0, reranked_rank=0,
        metadata={
            "ingested_at": (now - timedelta(days=1)).isoformat(),
            "expires_at": (now + timedelta(days=6)).isoformat(),
            "content_source": "web",
        },
    )
    near_expiry = RerankedResult(
        chunk_id="stale-ttl", document_id="doc", text="stale",
        score=0.8, original_rank=1, reranked_rank=1,
        metadata={
            "ingested_at": (now - timedelta(days=6)).isoformat(),
            "expires_at": (now + timedelta(hours=12)).isoformat(),
            "content_source": "web",
        },
    )

    results = apply_freshness([near_expiry, fresher_ttl], decay_weight=0.3, decay_days=30)
    assert results[0].chunk_id == "fresh-ttl"
    assert results[0].score > results[1].score


def test_all_expired_returns_empty():
    """If all chunks are expired, result is empty."""
    expired1 = _make_expired("e1", score=0.9)
    expired2 = _make_expired("e2", score=0.8)
    results = apply_freshness([expired1, expired2])
    assert results == []
