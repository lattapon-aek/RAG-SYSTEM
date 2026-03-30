"""
Query Intelligence module
- LLMQueryRewriter: rewrite query for better retrieval
- HyDEGenerator: generate hypothetical answer document
- QueryDecomposer: decompose complex query into sub-queries
"""
import logging
import re
from typing import List

from application.ports.i_query_rewriter import IQueryRewriter
from application.ports.i_hyde_generator import IHyDEGenerator
from application.ports.i_query_decomposer import IQueryDecomposer
from application.ports.i_llm_service import ILLMService

logger = logging.getLogger(__name__)


def _strip_thinking_tokens(text: str) -> str:
    """Remove LLM thinking/reasoning artifacts that leak into output."""
    # Remove <think>...</think> blocks (DeepSeek-style)
    text = re.sub(r'<think>.*?</think>', '', text, flags=re.DOTALL)
    # Remove stray closing tag
    text = re.sub(r'</think>', '', text)
    # Remove /think token (some Ollama models)
    text = re.sub(r'\s*/think\b.*', '', text)
    return text.strip()

_REWRITE_PROMPT = (
    "Rewrite the following search query to be more specific and retrieval-friendly. "
    "Return only the rewritten query, nothing else.\n\nQuery: {query}"
)

_HYDE_PROMPT = (
    "Write a short, factual passage that would answer the following question. "
    "Return only the passage.\n\nQuestion: {query}"
)

_DECOMPOSE_PROMPT = (
    "Break the following complex question into 2-4 simpler sub-questions. "
    "Return each sub-question on a new line, numbered.\n\nQuestion: {query}"
)


class LLMQueryRewriter(IQueryRewriter):
    def __init__(self, llm: ILLMService):
        self._llm = llm

    async def rewrite(self, query: str) -> str:
        try:
            result = _strip_thinking_tokens(
                await self._llm.generate(_REWRITE_PROMPT.format(query=query))
            )
            return result or query
        except Exception as exc:
            logger.warning("Query rewrite failed: %s — using original", exc)
            return query


class HyDEGenerator(IHyDEGenerator):
    def __init__(self, llm: ILLMService):
        self._llm = llm

    async def generate_hypothetical_document(self, query: str) -> str:
        try:
            return _strip_thinking_tokens(
                await self._llm.generate(_HYDE_PROMPT.format(query=query))
            ) or query
        except Exception as exc:
            logger.warning("HyDE generation failed: %s — using original query", exc)
            return query


class QueryDecomposer(IQueryDecomposer):
    def __init__(self, llm: ILLMService):
        self._llm = llm

    async def decompose(self, query: str) -> List[str]:
        try:
            raw = _strip_thinking_tokens(
                await self._llm.generate(_DECOMPOSE_PROMPT.format(query=query))
            )
            lines = [
                line.lstrip("0123456789. ").strip()
                for line in raw.splitlines()
                if line.strip()
            ]
            return lines if lines else [query]
        except Exception as exc:
            logger.warning("Query decomposition failed: %s — using original", exc)
            return [query]
