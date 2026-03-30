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


class HierarchicalChunker(IChunker):
    def __init__(self, parent_tokens: int = 1024, child_tokens: int = 256):
        self.parent_tokens = parent_tokens
        self.child_tokens = child_tokens
        self._enc = get_encoder()

    def _split_by_tokens(self, tokens: List[int], max_tokens: int) -> List[List[int]]:
        return [tokens[i:i + max_tokens] for i in range(0, len(tokens), max_tokens)]

    async def chunk(self, text: str, document_id: str, namespace: str = "default") -> List[Chunk]:
        all_tokens = self._enc.encode(text)
        parent_token_groups = self._split_by_tokens(all_tokens, self.parent_tokens)

        result: List[Chunk] = []
        sequence_index = 0

        for parent_tokens in parent_token_groups:
            parent_text = self._enc.decode(parent_tokens)
            parent_id = str(uuid4())
            result.append(
                Chunk(
                    id=parent_id,
                    document_id=document_id,
                    text=parent_text,
                    token_count=len(parent_tokens),
                    sequence_index=sequence_index,
                    chunk_type="parent",
                    parent_chunk_id=None,
                    namespace=namespace,
                )
            )
            sequence_index += 1

            child_token_groups = self._split_by_tokens(parent_tokens, self.child_tokens)
            for child_tokens in child_token_groups:
                child_text = self._enc.decode(child_tokens)
                result.append(
                    Chunk(
                        id=str(uuid4()),
                        document_id=document_id,
                        text=child_text,
                        token_count=len(child_tokens),
                        sequence_index=sequence_index,
                        chunk_type="child",
                        parent_chunk_id=parent_id,
                        namespace=namespace,
                    )
                )
                sequence_index += 1

        return result
