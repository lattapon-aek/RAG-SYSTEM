from abc import ABC, abstractmethod
from typing import List, Optional, Dict, Any


class IMemoryService(ABC):
    @abstractmethod
    async def get(self, user_id: str, query: str) -> List[Dict[str, Any]]:
        """Retrieve relevant memory entries for a user and query."""
        ...

    @abstractmethod
    async def save(self, user_id: str, content: str,
                   metadata: Optional[Dict[str, Any]] = None) -> str:
        """Save a memory entry, return memory id."""
        ...

    @abstractmethod
    async def list(self, user_id: str) -> List[Dict[str, Any]]:
        """List all memory entries for a user."""
        ...

    @abstractmethod
    async def delete(self, user_id: str, memory_id: str) -> None:
        """Delete a specific memory entry."""
        ...
