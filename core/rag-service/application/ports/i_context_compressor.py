from abc import ABC, abstractmethod
try:
    from domain.entities import BuiltContext, CompressedContext
except ImportError:
    from domain.entities import BuiltContext, CompressedContext  # type: ignore


class IContextCompressor(ABC):
    @abstractmethod
    async def compress(self, query: str, context: BuiltContext,
                       max_tokens: int = 4096) -> CompressedContext:
        """Compress context to fit within token budget."""
        ...
