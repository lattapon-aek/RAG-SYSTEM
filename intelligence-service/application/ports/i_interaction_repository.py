from abc import ABC, abstractmethod
from typing import List, Optional
from domain.entities import InteractionRecord


class IInteractionRepository(ABC):
    @abstractmethod
    async def list_recent(self, limit: int = 100) -> List[InteractionRecord]: ...

    @abstractmethod
    async def get_low_confidence(self, threshold: float, limit: int = 50) -> List[InteractionRecord]: ...

    @abstractmethod
    async def save(self, record: InteractionRecord) -> None: ...
