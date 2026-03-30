from abc import ABC, abstractmethod
from typing import List
from domain.entities import FeedbackRecord


class IFeedbackRepository(ABC):
    @abstractmethod
    async def save(self, feedback: FeedbackRecord) -> None: ...

    @abstractmethod
    async def list_by_request(self, request_id: str) -> List[FeedbackRecord]: ...
