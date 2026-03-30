"""
Context Builder
- Lost-in-the-Middle ordering
- Deduplication (overlap threshold)
- Graph entity injection
- Token budget enforcement
"""
import logging
from typing import List, Optional

import tiktoken

try:
    from application.ports.i_context_builder import IContextBuilder
    from domain.entities import RerankedResult, BuiltContext
except ImportError:
    from application.ports.i_context_builder import IContextBuilder  # type: ignore
    from domain.entities import RerankedResult, BuiltContext  # type: ignore

logger = logging.getLogger(__name__)

_OVERLAP_THRESHOLD = 0.8  # 80% word overlap → deduplicate


def _word_overlap(a: str, b: str) -> float:
    words_a = set(a.lower().split())
    words_b = set(b.lower().split())
    if not words_a or not words_b:
        return 0.0
    return len(words_a & words_b) / min(len(words_a), len(words_b))


class ContextBuilder(IContextBuilder):
    def __init__(self, encoding: str = "cl100k_base",
                 overlap_threshold: float = _OVERLAP_THRESHOLD):
        self._enc = tiktoken.get_encoding(encoding)
        self._overlap_threshold = overlap_threshold

    async def build(self, query: str, chunks: List[RerankedResult],
                    max_tokens: int = 4096,
                    graph_entities: Optional[List[str]] = None) -> BuiltContext:
        # 1. Deduplicate
        unique = self._deduplicate(chunks)

        # 2. Lost-in-the-Middle ordering
        ordered = self._lost_in_middle(unique)

        # 3. Token budget enforcement
        selected, total_tokens, was_truncated = self._enforce_budget(
            ordered, max_tokens, graph_entities
        )

        return BuiltContext(
            chunks=selected,
            total_tokens=total_tokens,
            was_truncated=was_truncated,
        )

    def _deduplicate(self, chunks: List[RerankedResult]) -> List[RerankedResult]:
        kept: List[RerankedResult] = []
        for chunk in chunks:
            is_dup = any(
                _word_overlap(chunk.text, k.text) >= self._overlap_threshold
                for k in kept
            )
            if not is_dup:
                kept.append(chunk)
        return kept

    def _lost_in_middle(self, chunks: List[RerankedResult]) -> List[RerankedResult]:
        """Place most relevant at beginning and end, less relevant in middle."""
        if len(chunks) <= 2:
            return chunks
        result = [None] * len(chunks)
        left, right = 0, len(chunks) - 1
        for i, chunk in enumerate(chunks):
            if i % 2 == 0:
                result[left] = chunk
                left += 1
            else:
                result[right] = chunk
                right -= 1
        return [c for c in result if c is not None]

    def _enforce_budget(self, chunks: List[RerankedResult], max_tokens: int,
                        graph_entities: Optional[List[str]]) -> tuple:
        selected: List[RerankedResult] = []
        total = 0
        was_truncated = False

        # Reserve tokens for graph entities section
        entity_tokens = 0
        if graph_entities:
            entity_text = "Entities: " + ", ".join(graph_entities)
            entity_tokens = len(self._enc.encode(entity_text))

        budget = max_tokens - entity_tokens

        for chunk in chunks:
            chunk_tokens = len(self._enc.encode(chunk.text))
            if total + chunk_tokens <= budget:
                selected.append(chunk)
                total += chunk_tokens
            else:
                was_truncated = True
                break

        return selected, total + entity_tokens, was_truncated
