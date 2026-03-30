"""
Context Compressor strategies
- NoOpCompressor: pass-through
- ExtractiveCompressor: score sentences, retain above threshold
- LLMCompressor: summarize each chunk with small LLM
"""
import logging
import re
from typing import List

import tiktoken

try:
    from application.ports.i_context_compressor import IContextCompressor
    from application.ports.i_llm_service import ILLMService
    from domain.entities import BuiltContext, CompressedContext
except ImportError:
    from application.ports.i_context_compressor import IContextCompressor  # type: ignore
    from application.ports.i_llm_service import ILLMService  # type: ignore
    from domain.entities import BuiltContext, CompressedContext  # type: ignore

logger = logging.getLogger(__name__)

_SUMMARIZE_PROMPT = (
    "Summarize the following passage to answer the question concisely. "
    "Keep only information relevant to the question.\n\n"
    "Question: {query}\n\nPassage: {text}\n\nSummary:"
)


class NoOpCompressor(IContextCompressor):
    """Pass-through — returns context as-is."""

    async def compress(self, query: str, context: BuiltContext,
                       max_tokens: int = 4096) -> CompressedContext:
        full_text = "\n\n".join(c.text for c in context.chunks)
        return CompressedContext(
            text=full_text,
            original_tokens=context.total_tokens,
            compressed_tokens=context.total_tokens,
            method="none",
        )


class ExtractiveCompressor(IContextCompressor):
    """Score sentences by keyword overlap with query, retain above threshold."""

    def __init__(self, threshold: float = 0.1, encoding: str = "cl100k_base"):
        self._threshold = threshold
        self._enc = tiktoken.get_encoding(encoding)

    def _score_sentence(self, sentence: str, query_words: set) -> float:
        words = set(sentence.lower().split())
        if not words:
            return 0.0
        return len(words & query_words) / len(words)

    async def compress(self, query: str, context: BuiltContext,
                       max_tokens: int = 4096) -> CompressedContext:
        query_words = set(query.lower().split())
        retained: List[str] = []
        original_tokens = context.total_tokens

        for chunk in context.chunks:
            sentences = re.split(r'(?<=[.!?])\s+', chunk.text)
            for sentence in sentences:
                if self._score_sentence(sentence, query_words) >= self._threshold:
                    retained.append(sentence)

        compressed_text = " ".join(retained)
        compressed_tokens = len(self._enc.encode(compressed_text))

        return CompressedContext(
            text=compressed_text,
            original_tokens=original_tokens,
            compressed_tokens=compressed_tokens,
            method="extractive",
        )


class LLMCompressor(IContextCompressor):
    """Summarize each chunk with LLM conditioned on query."""

    def __init__(self, llm: ILLMService, encoding: str = "cl100k_base"):
        self._llm = llm
        self._enc = tiktoken.get_encoding(encoding)

    async def compress(self, query: str, context: BuiltContext,
                       max_tokens: int = 4096) -> CompressedContext:
        original_tokens = context.total_tokens
        summaries: List[str] = []

        for chunk in context.chunks:
            try:
                summary = await self._llm.generate(
                    _SUMMARIZE_PROMPT.format(query=query, text=chunk.text),
                    max_tokens=256,
                )
                summaries.append(summary.strip())
            except Exception as exc:
                logger.warning("LLM compression failed for chunk: %s", exc)
                summaries.append(chunk.text)  # fallback to original

        compressed_text = "\n\n".join(summaries)
        compressed_tokens = len(self._enc.encode(compressed_text))

        return CompressedContext(
            text=compressed_text,
            original_tokens=original_tokens,
            compressed_tokens=compressed_tokens,
            method="llm",
        )
