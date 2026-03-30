"""
RoutingPolicy — single source of truth for all routing and quality thresholds.

All decision points in the query pipeline read from one object.
Create via RoutingPolicy.from_env() at service startup.
"""
import os
from dataclasses import dataclass


@dataclass
class RoutingPolicy:
    # ── Semantic cache ────────────────────────────────────────────────────────
    semantic_cache_threshold: float = 0.92     # cosine similarity for cache hit

    # ── Context building / dedup ──────────────────────────────────────────────
    context_dedup_overlap_threshold: float = 0.8   # word overlap → deduplicate chunks
    context_compression_threshold: float = 0.1     # min sentence score to keep (extractive)

    # ── Citation / hallucination detection ───────────────────────────────────
    grounding_threshold: float = 0.5           # grounding_score < this → low_confidence
    citation_overlap_threshold: float = 0.15   # min token overlap for a verified citation

    # ── Knowledge gap detection ───────────────────────────────────────────────
    knowledge_gap_threshold: float = 0.6       # log gap if top reranked score < this

    @classmethod
    def from_env(cls) -> "RoutingPolicy":
        """Read all thresholds from environment variables (called once at startup)."""
        return cls(
            semantic_cache_threshold=float(os.getenv("SEMANTIC_CACHE_THRESHOLD", "0.92")),
            context_dedup_overlap_threshold=float(os.getenv("CONTEXT_DEDUP_OVERLAP_THRESHOLD", "0.8")),
            context_compression_threshold=float(os.getenv("CONTEXT_COMPRESSION_THRESHOLD", "0.1")),
            grounding_threshold=float(os.getenv("GROUNDING_THRESHOLD", "0.5")),
            citation_overlap_threshold=float(os.getenv("CITATION_OVERLAP_THRESHOLD", "0.15")),
            knowledge_gap_threshold=float(os.getenv("KNOWLEDGE_GAP_THRESHOLD", "0.6")),
        )
