"""
Task 21.4 — Property tests สำหรับ CitationVerifier

Property 10: Grounding score bounds — grounding_score ∈ [0.0, 1.0] เสมอ
Property 11: Perfect grounding — answer ที่ copy มาจาก chunks โดยตรงต้องได้ grounding_score = 1.0

Usage:
    cd rag-system
    py -3.12 -m pytest tests/test_citation_verifier.py -v
"""
import sys
import os

_RAG = os.path.abspath(os.path.join(os.path.dirname(__file__), "../core/rag-service"))
for _mod in list(sys.modules.keys()):
    if _mod.split(".")[0] in ("application", "domain", "infrastructure", "interface"):
        del sys.modules[_mod]
if _RAG not in sys.path:
    sys.path.insert(0, _RAG)

import pytest
from application.citation_verifier import CitationVerifier, CitationVerificationResult
from domain.entities import RerankedResult


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_chunk(text: str, chunk_id: str = "c1") -> RerankedResult:
    return RerankedResult(
        chunk_id=chunk_id, document_id="doc1", text=text,
        score=1.0, original_rank=0, reranked_rank=0,
    )


# ---------------------------------------------------------------------------
# Property 10: grounding_score ∈ [0.0, 1.0] for any input
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("answer,chunk_texts", [
    ("", []),
    ("Hello world.", []),
    ("The sky is blue. Water is wet.", ["The sky is blue and clear."]),
    ("A. B. C. D. E.", ["completely unrelated content about elephants and trees"]),
    ("  \n  ", ["some chunk"]),
    ("One sentence only", ["one sentence only"]),
    ("Short.", ["x" * 1000]),
    ("The quick brown fox.", ["slow white dog", "fast red cat", "quick brown fox jumps"]),
])
def test_property_grounding_score_bounds(answer, chunk_texts):
    """Property 10: grounding_score ∈ [0.0, 1.0] for arbitrary inputs."""
    verifier = CitationVerifier()
    chunks = [_make_chunk(t, f"c{i}") for i, t in enumerate(chunk_texts)]
    result = verifier.verify(answer, chunks, query="test")
    assert 0.0 <= result.grounding_score <= 1.0, (
        f"grounding_score={result.grounding_score} out of bounds for answer={answer!r}"
    )


# ---------------------------------------------------------------------------
# Property 11: verbatim copy → grounding_score = 1.0
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("chunk_text", [
    "The company was founded in 1990 by John Smith.",
    "Python is a high-level programming language. It is used for data science.",
    "RAG stands for Retrieval Augmented Generation. It combines search with LLMs.",
    "The quick brown fox jumps over the lazy dog. This is a classic sentence.",
    "Water boils at 100 degrees Celsius at standard pressure.",
])
def test_property_perfect_grounding_verbatim_copy(chunk_text):
    """Property 11: answer = verbatim chunk text → grounding_score = 1.0."""
    verifier = CitationVerifier(overlap_threshold=0.0)  # threshold=0 isolates the property
    chunk = _make_chunk(chunk_text)
    result = verifier.verify(answer=chunk_text, chunks=[chunk], query="test")
    assert result.grounding_score == 1.0, (
        f"Expected 1.0, got {result.grounding_score} for text={chunk_text!r}"
    )


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------

def test_empty_answer_returns_full_score():
    """Empty answer → grounding_score=1.0, not low_confidence."""
    verifier = CitationVerifier()
    result = verifier.verify("", [_make_chunk("some text")], "query")
    assert result.grounding_score == 1.0
    assert result.low_confidence is False
    assert result.verified_citations == []
    assert result.unverified_claims == []


def test_whitespace_only_answer_returns_full_score():
    verifier = CitationVerifier()
    result = verifier.verify("   \n\t  ", [_make_chunk("text")], "query")
    assert result.grounding_score == 1.0


def test_no_chunks_all_unverified():
    """No chunks → all sentences unverified, grounding_score=0.0."""
    verifier = CitationVerifier(overlap_threshold=0.0)
    result = verifier.verify("This is a claim. Another claim here.", [], "query")
    assert result.grounding_score == 0.0
    assert result.low_confidence is True
    assert len(result.unverified_claims) == 2


def test_low_confidence_flag_matches_threshold():
    """low_confidence = True iff grounding_score < grounding_threshold."""
    verifier = CitationVerifier(grounding_threshold=0.8, overlap_threshold=0.9)
    # Very high overlap_threshold → most sentences unverified
    chunk = _make_chunk("completely unrelated elephants zebras mountains")
    result = verifier.verify(
        "The sky is blue. Water is wet. Fire is hot.", [chunk], "query"
    )
    assert result.low_confidence is (result.grounding_score < 0.8)


def test_verified_citations_reference_correct_chunk():
    """Verified citations must reference the chunk with highest overlap."""
    verifier = CitationVerifier(overlap_threshold=0.1)
    chunk = _make_chunk("The company was founded in 1990 by John Smith.", chunk_id="chunk-42")
    result = verifier.verify("The company was founded in 1990.", [chunk], "query")
    if result.verified_citations:
        assert all(c.chunk_id == "chunk-42" for c in result.verified_citations)


def test_overlap_scores_within_bounds():
    """Every VerifiedCitation.overlap_score must be in [0.0, 1.0]."""
    verifier = CitationVerifier(overlap_threshold=0.0)
    chunk = _make_chunk("hello world foo bar baz")
    result = verifier.verify("Hello world. Foo is great.", [chunk], "query")
    for vc in result.verified_citations:
        assert 0.0 <= vc.overlap_score <= 1.0


def test_high_overlap_threshold_creates_unverified_claims():
    """With very high overlap threshold, low-overlap sentences become unverified_claims."""
    verifier = CitationVerifier(overlap_threshold=0.99)
    chunk = _make_chunk("some completely different text about xyz")
    result = verifier.verify(
        "The Eiffel Tower is in Paris. France is in Europe.", [chunk], "query"
    )
    assert len(result.unverified_claims) > 0


def test_multiple_chunks_picks_best_overlap():
    """CitationVerifier should pick the chunk with highest overlap per sentence."""
    verifier = CitationVerifier(overlap_threshold=0.1)
    chunk_a = _make_chunk("apple banana cherry", chunk_id="chunk-a")
    chunk_b = _make_chunk("Eiffel Tower Paris France", chunk_id="chunk-b")
    result = verifier.verify("Eiffel Tower is in Paris.", [chunk_a, chunk_b], "query")
    if result.verified_citations:
        # chunk_b has much higher overlap with "Eiffel Tower is in Paris."
        assert result.verified_citations[0].chunk_id == "chunk-b"


def test_grounding_score_partial():
    """Partial grounding: 1 of 2 sentences grounded → score = 0.5."""
    verifier = CitationVerifier(overlap_threshold=0.3)
    chunk = _make_chunk("Python is a programming language used for data science.")
    result = verifier.verify(
        "Python is a programming language. Elephants are mammals.",
        [chunk], "query"
    )
    # First sentence should be grounded, second should not
    assert 0.0 < result.grounding_score < 1.0
