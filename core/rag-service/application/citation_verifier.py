"""
CitationVerifier — token-overlap-based hallucination detection.

Operates synchronously (pure CPU, no IO) immediately after LLM generation.
Computes grounding_score = grounded_sentences / total_sentences.
"""
import re
import os
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

from domain.entities import RerankedResult

_GROUNDING_THRESHOLD = float(os.getenv("GROUNDING_THRESHOLD", "0.5"))
_OVERLAP_THRESHOLD = float(os.getenv("CITATION_OVERLAP_THRESHOLD", "0.15"))
_SENTENCE_SPLITTER = re.compile(r'(?<=[.!?])\s+')


@dataclass
class VerifiedCitation:
    chunk_id: str
    sentence: str
    overlap_score: float   # 0.0–1.0


@dataclass
class CitationVerificationResult:
    grounding_score: float
    verified_citations: List[VerifiedCitation]
    unverified_claims: List[str]
    low_confidence: bool


class CitationVerifier:
    def __init__(
        self,
        grounding_threshold: float = _GROUNDING_THRESHOLD,
        overlap_threshold: float = _OVERLAP_THRESHOLD,
    ):
        self._grounding_threshold = grounding_threshold
        self._overlap_threshold = overlap_threshold

    def verify(
        self,
        answer: str,
        chunks: List[RerankedResult],
        query: str,
    ) -> CitationVerificationResult:
        sentences = self._split_sentences(answer)
        if not sentences:
            return CitationVerificationResult(
                grounding_score=1.0,
                verified_citations=[],
                unverified_claims=[],
                low_confidence=False,
            )

        verified: List[VerifiedCitation] = []
        unverified: List[str] = []

        for sentence in sentences:
            best_chunk, best_score = self._best_chunk_overlap(sentence, chunks)
            if best_score >= self._overlap_threshold and best_chunk is not None:
                verified.append(VerifiedCitation(
                    chunk_id=best_chunk.chunk_id,
                    sentence=sentence,
                    overlap_score=best_score,
                ))
            else:
                unverified.append(sentence)

        grounding_score = len(verified) / len(sentences)
        low_confidence = grounding_score < self._grounding_threshold

        return CitationVerificationResult(
            grounding_score=grounding_score,
            verified_citations=verified,
            unverified_claims=unverified,
            low_confidence=low_confidence,
        )

    def _split_sentences(self, text: str) -> List[str]:
        raw = _SENTENCE_SPLITTER.split(text.strip())
        return [s.strip() for s in raw if s.strip()]

    def _token_overlap(self, sentence: str, chunk_text: str) -> float:
        """
        overlap = |sentence_tokens ∩ chunk_tokens| / |sentence_tokens|
        Measures: what fraction of the sentence's words appear in the chunk.
        """
        sentence_tokens = set(sentence.lower().split())
        if not sentence_tokens:
            return 0.0
        chunk_tokens = set(chunk_text.lower().split())
        return len(sentence_tokens & chunk_tokens) / len(sentence_tokens)

    def _best_chunk_overlap(
        self, sentence: str, chunks: List[RerankedResult]
    ) -> Tuple[Optional[RerankedResult], float]:
        best_score = 0.0
        best_chunk: Optional[RerankedResult] = None
        for chunk in chunks:
            score = self._token_overlap(sentence, chunk.text)
            if score > best_score:
                best_score = score
                best_chunk = chunk
        return best_chunk, best_score
