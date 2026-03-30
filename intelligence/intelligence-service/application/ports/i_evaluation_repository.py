from abc import ABC, abstractmethod
from typing import List
from domain.entities import EvaluationResult, EvaluationSummary


class IEvaluationRepository(ABC):
    @abstractmethod
    async def save(self, result: EvaluationResult) -> None: ...

    @abstractmethod
    async def list_recent(self, limit: int = 100) -> List[EvaluationResult]: ...

    @abstractmethod
    async def get_summary(self) -> EvaluationSummary: ...
