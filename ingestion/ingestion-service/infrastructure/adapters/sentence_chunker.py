import re
from uuid import uuid4
from typing import List

try:
    from application.ports.i_chunker import IChunker
    from domain.entities import Chunk
    from infrastructure.adapters.tokenizer_utils import get_encoder
except ImportError:
    from application.ports.i_chunker import IChunker  # type: ignore
    from domain.entities import Chunk  # type: ignore
    from infrastructure.adapters.tokenizer_utils import get_encoder  # type: ignore

_SENTENCE_SPLIT_RE = re.compile(r'(?<=[.!?])\s+')


class SentenceChunker(IChunker):
    def __init__(self, max_tokens: int = 512):
        self.max_tokens = max_tokens
        self._enc = get_encoder()

    def _split_sentences(self, text: str) -> List[str]:
        parts = _SENTENCE_SPLIT_RE.split(text.strip())
        return [p for p in parts if p]

    async def chunk(self, text: str, document_id: str, namespace: str = "default") -> List[Chunk]:
        sentences = self._split_sentences(text)
        chunks: List[Chunk] = []
        current_sentences: List[str] = []
        current_tokens = 0
        sequence_index = 0

        for sentence in sentences:
            sentence_tokens = len(self._enc.encode(sentence))
            if current_tokens + sentence_tokens > self.max_tokens and current_sentences:
                chunk_text = " ".join(current_sentences)
                chunks.append(
                    Chunk(
                        id=str(uuid4()),
                        document_id=document_id,
                        text=chunk_text,
                        token_count=current_tokens,
                        sequence_index=sequence_index,
                        chunk_type="flat",
                        namespace=namespace,
                    )
                )
                sequence_index += 1
                current_sentences = []
                current_tokens = 0
            current_sentences.append(sentence)
            current_tokens += sentence_tokens

        if current_sentences:
            chunk_text = " ".join(current_sentences)
            chunks.append(
                Chunk(
                    id=str(uuid4()),
                    document_id=document_id,
                    text=chunk_text,
                    token_count=current_tokens,
                    sequence_index=sequence_index,
                    chunk_type="flat",
                    namespace=namespace,
                )
            )

        return chunks
