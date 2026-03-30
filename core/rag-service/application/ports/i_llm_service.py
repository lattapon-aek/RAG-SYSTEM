from abc import ABC, abstractmethod
from typing import AsyncIterator, Optional


class ILLMService(ABC):
    @abstractmethod
    async def generate(self, prompt: str, system_prompt: Optional[str] = None,
                       max_tokens: int = 1024) -> str:
        """Generate a response (non-streaming)."""
        ...

    @abstractmethod
    async def generate_stream(self, prompt: str,
                              system_prompt: Optional[str] = None,
                              max_tokens: int = 1024) -> AsyncIterator[str]:
        """Generate a streaming response."""
        ...
