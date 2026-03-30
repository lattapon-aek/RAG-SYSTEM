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


class FixedChunker(IChunker):
    def __init__(self, max_tokens: int = 512, overlap_tokens: int = 0):
        self.max_tokens = max_tokens
        # overlap must be strictly less than max_tokens to avoid infinite loop
        self.overlap_tokens = min(overlap_tokens, max_tokens - 1) if max_tokens > 0 else 0
        self._enc = get_encoder()

    async def chunk(self, text: str, document_id: str, namespace: str = "default") -> List[Chunk]:
        if not text:
            return []
        tokens = self._enc.encode(text)
        chunks: List[Chunk] = []
        sequence_index = 0
        start = 0
        step = self.max_tokens - self.overlap_tokens  # always >= 1

        while start < len(tokens):
            end = min(start + self.max_tokens, len(tokens))
            chunk_tokens = tokens[start:end]
            chunk_text = self._enc.decode(chunk_tokens)
            chunks.append(
                Chunk(
                    id=str(uuid4()),
                    document_id=document_id,
                    text=chunk_text,
                    token_count=len(chunk_tokens),
                    sequence_index=sequence_index,
                    chunk_type="flat",
                    namespace=namespace,
                )
            )
            sequence_index += 1
            if end == len(tokens):
                break
            start += step

        return chunks
