from abc import ABC, abstractmethod
from typing import List, Optional
from domain.entities import FeedbackRecord


class IFeedbackRepository(ABC):
    @abstractmethod
    async def save(self, record: FeedbackRecord) -> None: ...

    @abstractmethod
    async def list_recent(self, limit: int = 100) -> List[FeedbackRecord]: ...

    @abstractmethod
    async def get_avg_score(self) -> float: ...
