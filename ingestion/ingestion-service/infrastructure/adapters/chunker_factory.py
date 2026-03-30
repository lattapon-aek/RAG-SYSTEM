from application.ports.i_chunker import IChunker
from domain.errors import UnsupportedFileFormatError
from .fixed_chunker import FixedChunker
from .sentence_chunker import SentenceChunker
from .hierarchical_chunker import HierarchicalChunker
from .semantic_chunker import SemanticChunker

_CHUNKER_MAP = {
    "fixed": FixedChunker,
    "sentence": SentenceChunker,
    "hierarchical": HierarchicalChunker,
    "semantic": SemanticChunker,
}


class ChunkerFactory:
    @staticmethod
    def create(chunker_type: str, **kwargs) -> IChunker:
        chunker_class = _CHUNKER_MAP.get(chunker_type)
        if chunker_class is None:
            raise UnsupportedFileFormatError(f"Unsupported chunker type: {chunker_type}")
        return chunker_class(**kwargs)
