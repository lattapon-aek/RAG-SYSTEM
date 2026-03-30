"""
FreshnessScorer — applies temporal decay to retrieved chunk scores
and filters out expired documents.
"""
import os
from datetime import datetime, timezone
from typing import List

from domain.entities import RerankedResult

_DECAY_WEIGHT = float(os.getenv("FRESHNESS_DECAY_WEIGHT", "0.1"))
_DECAY_DAYS = float(os.getenv("FRESHNESS_DECAY_DAYS", "365"))  # full decay after N days


def _parse_iso(value: str) -> datetime:
    """Parse ISO datetime string, returning UTC-aware datetime."""
    dt = datetime.fromisoformat(value)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _freshness_from_age(now: datetime, ingested_at_raw: str, decay_days: float) -> float:
    ingested_at = _parse_iso(ingested_at_raw)
    age_days = max(0.0, (now - ingested_at).total_seconds() / 86400)
    return max(0.0, 1.0 - age_days / decay_days)


def _freshness_from_ttl(now: datetime, ingested_at_raw: str, expires_at_raw: str) -> float:
    ingested_at = _parse_iso(ingested_at_raw)
    expires_at = _parse_iso(expires_at_raw)
    total_ttl = max((expires_at - ingested_at).total_seconds(), 0.0)
    remaining = max((expires_at - now).total_seconds(), 0.0)
    if total_ttl <= 0:
        return 0.0
    return max(0.0, min(1.0, remaining / total_ttl))


def apply_freshness(
    results: List[RerankedResult],
    decay_weight: float = _DECAY_WEIGHT,
    decay_days: float = _DECAY_DAYS,
) -> List[RerankedResult]:
    """
    For each result:
    1. Filter out chunks whose `expires_at` has passed.
    2. Blend semantic score with freshness score:
       adjusted = score * (1 - decay_weight) + freshness * decay_weight
       freshness = max(0, 1 - age_days / decay_days)
    Returns a new list sorted by adjusted score descending.
    """
    now = datetime.now(timezone.utc)
    output: List[RerankedResult] = []

    for r in results:
        # Skip expired chunks
        expires_at_raw = r.metadata.get("expires_at")
        if expires_at_raw:
            try:
                expires_at = _parse_iso(expires_at_raw)
                if now > expires_at:
                    continue  # expired — exclude
            except (ValueError, TypeError):
                pass  # unparseable — don't exclude

        # Compute freshness boost. Time-bounded content (web/news with expires_at)
        # decays by remaining TTL so stale pages stop outranking fresher material.
        ingested_at_raw = r.metadata.get("ingested_at")
        if ingested_at_raw and decay_weight > 0:
            try:
                freshness = _freshness_from_age(now, ingested_at_raw, decay_days)
                if expires_at_raw:
                    ttl_freshness = _freshness_from_ttl(now, ingested_at_raw, expires_at_raw)
                    freshness = min(freshness, ttl_freshness)
                adjusted = r.score * (1 - decay_weight) + freshness * decay_weight
                # Return a new result with adjusted score
                r = RerankedResult(
                    chunk_id=r.chunk_id,
                    document_id=r.document_id,
                    text=r.text,
                    score=adjusted,
                    original_rank=r.original_rank,
                    reranked_rank=r.reranked_rank,
                    namespace=r.namespace,
                    metadata=r.metadata,
                )
            except (ValueError, TypeError):
                pass  # unparseable — keep original score

        output.append(r)

    # Re-sort by adjusted score
    output.sort(key=lambda x: x.score, reverse=True)
    return output
