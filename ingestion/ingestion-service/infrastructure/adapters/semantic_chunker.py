import inspect
import logging
import re
from dataclasses import dataclass
from typing import Awaitable, Callable, List, Optional, Sequence
from uuid import uuid4

from application.ports.i_chunker import IChunker
from domain.entities import Chunk
from .tokenizer_utils import get_encoder

logger = logging.getLogger(__name__)

_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+|(?<=[。！？])\s*|\n+")
_MARKDOWN_HEADING_RE = re.compile(r"^\s{0,3}#{1,6}\s+.+$")
_HORIZONTAL_RULE_RE = re.compile(r"^\s*([-*_])(?:\s*\1){2,}\s*$")


@dataclass(frozen=True)
class _Unit:
    text: str
    hard_boundary_before: bool = False


def _cosine_similarity(a: List[float], b: List[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = sum(x * x for x in a) ** 0.5
    norm_b = sum(x * x for x in b) ** 0.5
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


class SemanticChunker(IChunker):
    def __init__(
        self,
        similarity_threshold: float = 0.8,
        max_tokens: int = 512,
        embedding_fn: Optional[Callable[[str], List[float]]] = None,
        embed_batch_fn: Optional[Callable[[List[str]], Awaitable[List[List[float]]]]] = None,
    ):
        self.similarity_threshold = similarity_threshold
        self.max_tokens = max_tokens
        self.embedding_fn = embedding_fn
        self.embed_batch_fn = embed_batch_fn
        self._enc = get_encoder()
        self.last_chunk_mode = "semantic"
        self.last_chunk_fallback_reason = ""
        if self.embedding_fn is None and self.embed_batch_fn is None:
            raise ValueError(
                "SemanticChunker requires embedding_fn or embed_batch_fn. "
                "Semantic mode must be wired to an embedding backend."
            )

    def _token_count(self, text: str) -> int:
        return len(self._enc.encode(text))

    def _split_paragraph_blocks(self, text: str) -> List[str]:
        normalized = text.replace("\r\n", "\n").replace("\r", "\n")
        blocks: List[str] = []
        current_lines: List[str] = []

        for raw_line in normalized.split("\n"):
            line = raw_line.rstrip()
            stripped = line.strip()
            if not stripped:
                if current_lines:
                    blocks.append("\n".join(current_lines).strip())
                    current_lines = []
                continue
            if _HORIZONTAL_RULE_RE.match(stripped):
                if current_lines:
                    blocks.append("\n".join(current_lines).strip())
                    current_lines = []
                continue
            current_lines.append(line)

        if current_lines:
            blocks.append("\n".join(current_lines).strip())

        return [block for block in blocks if block]

    def _split_text_fragments(self, text: str) -> List[str]:
        parts = _SENTENCE_SPLIT_RE.split(text.strip())
        return [part.strip() for part in parts if part.strip()]

    def _split_oversized_block(self, block: str) -> List[str]:
        if self._token_count(block) <= self.max_tokens:
            return [block]

        lines = [line.strip() for line in block.splitlines() if line.strip()]
        heading = ""
        body = block
        if lines and _MARKDOWN_HEADING_RE.match(lines[0]):
            heading = lines[0]
            body = "\n".join(lines[1:]).strip()
            if not body:
                return [block]

        fragments = self._split_text_fragments(body)
        if not fragments:
            fragments = [body]

        chunks: List[str] = []
        current_parts: List[str] = [heading] if heading else []
        current_tokens = self._token_count(heading) if heading else 0

        for fragment in fragments:
            fragment_tokens = self._token_count(fragment)
            if current_parts and current_tokens + fragment_tokens > self.max_tokens:
                chunk_text = "\n".join(current_parts) if heading and len(current_parts) > 1 else " ".join(current_parts)
                chunks.append(chunk_text.strip())
                current_parts = [heading] if heading else []
                current_tokens = self._token_count(heading) if heading else 0

            if fragment_tokens > self.max_tokens:
                fragment_tokens_list = self._enc.encode(fragment)
                start = 0
                while start < len(fragment_tokens_list):
                    end = min(start + self.max_tokens, len(fragment_tokens_list))
                    slice_text = self._enc.decode(fragment_tokens_list[start:end]).strip()
                    if heading:
                        slice_text = f"{heading}\n{slice_text}".strip()
                    chunks.append(slice_text)
                    start = end
                continue

            current_parts.append(fragment)
            current_tokens += fragment_tokens

        if current_parts:
            chunk_text = "\n".join(current_parts) if heading and len(current_parts) > 1 else " ".join(current_parts)
            chunks.append(chunk_text.strip())

        return [chunk for chunk in chunks if chunk]

    def _build_units(self, text: str) -> List[_Unit]:
        blocks = self._split_paragraph_blocks(text)
        if not blocks:
            return []

        units: List[_Unit] = []
        idx = 0
        while idx < len(blocks):
            block = blocks[idx]
            if _MARKDOWN_HEADING_RE.match(block) and idx + 1 < len(blocks):
                merged = f"{block}\n\n{blocks[idx + 1]}".strip()
                for piece in self._split_oversized_block(merged):
                    units.append(_Unit(text=piece, hard_boundary_before=True))
                idx += 2
                continue

            hard_boundary = _MARKDOWN_HEADING_RE.match(block) is not None
            for piece in self._split_oversized_block(block):
                units.append(_Unit(text=piece, hard_boundary_before=hard_boundary))
            idx += 1

        return units

    async def _embed_units(self, texts: Sequence[str]) -> List[List[float]]:
        if self.embed_batch_fn is not None:
            return await self.embed_batch_fn(list(texts))

        assert self.embedding_fn is not None
        vectors: List[List[float]] = []
        for text in texts:
            vector = self.embedding_fn(text)
            if inspect.isawaitable(vector):
                vector = await vector
            vectors.append(vector)
        return vectors

    def _flush_chunk(
        self,
        chunks: List[Chunk],
        document_id: str,
        namespace: str,
        sequence_index: int,
        texts: List[str],
    ) -> int:
        chunk_text = "\n\n".join(texts).strip()
        if not chunk_text:
            return sequence_index
        chunks.append(
            Chunk(
                id=str(uuid4()),
                document_id=document_id,
                text=chunk_text,
                token_count=self._token_count(chunk_text),
                sequence_index=sequence_index,
                chunk_type="semantic",
                namespace=namespace,
            )
        )
        return sequence_index + 1

    def _structural_fallback(self, units: Sequence[_Unit], document_id: str, namespace: str) -> List[Chunk]:
        chunks: List[Chunk] = []
        current_texts: List[str] = []
        current_tokens = 0
        sequence_index = 0

        for unit in units:
            unit_tokens = self._token_count(unit.text)
            should_split = bool(current_texts) and (
                unit.hard_boundary_before or current_tokens + unit_tokens > self.max_tokens
            )
            if should_split:
                sequence_index = self._flush_chunk(chunks, document_id, namespace, sequence_index, current_texts)
                current_texts = []
                current_tokens = 0

            current_texts.append(unit.text)
            current_tokens += unit_tokens

        if current_texts:
            self._flush_chunk(chunks, document_id, namespace, sequence_index, current_texts)

        return chunks

    async def chunk(self, text: str, document_id: str, namespace: str = "default") -> List[Chunk]:
        self.last_chunk_mode = "semantic"
        self.last_chunk_fallback_reason = ""
        units = self._build_units(text)
        if not units:
            return []

        try:
            embeddings = await self._embed_units([unit.text for unit in units])
        except Exception as exc:
            logger.warning(
                "SemanticChunker embedding backend unavailable; falling back to structural chunking: %s",
                exc,
            )
            self.last_chunk_mode = "structural_fallback"
            self.last_chunk_fallback_reason = str(exc)
            return self._structural_fallback(units, document_id, namespace)

        chunks: List[Chunk] = []
        current_texts: List[str] = []
        current_tokens = 0
        sequence_index = 0

        for idx, unit in enumerate(units):
            unit_tokens = self._token_count(unit.text)
            should_split = False

            if current_texts:
                if unit.hard_boundary_before:
                    should_split = True
                if _cosine_similarity(embeddings[idx - 1], embeddings[idx]) < self.similarity_threshold:
                    should_split = True
                if current_tokens + unit_tokens > self.max_tokens:
                    should_split = True

            if should_split and current_texts:
                sequence_index = self._flush_chunk(
                    chunks, document_id, namespace, sequence_index, current_texts
                )
                current_texts = []
                current_tokens = 0

            current_texts.append(unit.text)
            current_tokens += unit_tokens

        if current_texts:
            self._flush_chunk(chunks, document_id, namespace, sequence_index, current_texts)

        return chunks
