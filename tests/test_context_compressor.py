"""
Unit tests for LLM context compression.

Usage:
    cd rag-system
    py -3.12 -m pytest tests/test_context_compressor.py -v
"""
import os
import sys

_RAG = os.path.abspath(os.path.join(os.path.dirname(__file__), "../core/rag-service"))
if _RAG not in sys.path:
    sys.path.insert(0, _RAG)

import pytest

import application.context_compressor as context_compressor
from application.context_compressor import LLMCompressor
from domain.entities import BuiltContext, RerankedResult


class _FakeLLM:
    def __init__(self, response: str):
        self.response = response
        self.calls = 0
        self.prompts = []

    async def generate(self, prompt, system_prompt=None, max_tokens=1024):
        self.calls += 1
        self.prompts.append(
            {
                "prompt": prompt,
                "system_prompt": system_prompt,
                "max_tokens": max_tokens,
            }
        )
        return self.response

    async def generate_stream(self, prompt, system_prompt=None, max_tokens=1024):
        raise NotImplementedError


class _FakeEncoding:
    def encode(self, text):
        return text.split()


def _make_context() -> BuiltContext:
    return BuiltContext(
        chunks=[
            RerankedResult(
                chunk_id="c1",
                document_id="doc1",
                text="Alice leads the ABAP team.",
                score=1.0,
                original_rank=0,
                reranked_rank=0,
            ),
            RerankedResult(
                chunk_id="c2",
                document_id="doc1",
                text="Bob handles urgent bug fixes.",
                score=0.9,
                original_rank=1,
                reranked_rank=1,
            ),
        ],
        total_tokens=12,
        was_truncated=False,
    )


@pytest.mark.asyncio
async def test_llm_compressor_is_single_pass_and_template_shaped():
    context_compressor.tiktoken.get_encoding = lambda encoding: _FakeEncoding()
    llm = _FakeLLM("Alice leads the ABAP team.")
    compressor = LLMCompressor(llm=llm)

    result = await compressor.compress("Who leads the team?", _make_context())

    assert llm.calls == 1
    assert "Query:" in result.text
    assert "Facts:" in result.text
    assert "Relationships:" in result.text
    assert "Notes:" not in result.text
    assert "Alice leads the ABAP team." in result.text


@pytest.mark.asyncio
async def test_llm_compressor_returns_empty_when_no_grounded_content():
    context_compressor.tiktoken.get_encoding = lambda encoding: _FakeEncoding()
    llm = _FakeLLM("Should not be used.")
    compressor = LLMCompressor(llm=llm)
    empty_context = BuiltContext(chunks=[], total_tokens=0, was_truncated=False)

    result = await compressor.compress("Who leads the team?", empty_context)

    assert llm.calls == 0
    assert result.text == ""
    assert result.method == "empty"


@pytest.mark.asyncio
async def test_llm_compressor_uses_graph_summary_as_first_class_context():
    context_compressor.tiktoken.get_encoding = lambda encoding: _FakeEncoding()
    llm = _FakeLLM("Query: Who leads?\nFacts:\n- Alice leads the team.\nRelationships:\n- Alice is a member of Team A.")
    compressor = LLMCompressor(llm=llm)
    context = BuiltContext(
        chunks=[
            RerankedResult(
                chunk_id="ctx",
                document_id="graph",
                text="[Graph Summary]\n- Alice is a member of Team A\n- Alice has role: Lead",
                score=1.0,
                original_rank=0,
                reranked_rank=0,
            )
        ],
        total_tokens=8,
        was_truncated=False,
    )

    result = await compressor.compress("Who leads?", context)

    assert llm.calls == 1
    assert "[Graph Summary]" in llm.prompts[0]["prompt"]
    assert "Alice is a member of Team A" in llm.prompts[0]["prompt"]
    assert "Alice has role: Lead" in llm.prompts[0]["prompt"]
    assert result.text.startswith("Query:")
