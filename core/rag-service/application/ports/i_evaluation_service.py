from abc import ABC, abstractmethod
from domain.entities import EvaluationResult


class IEvaluationService(ABC):
    @abstractmethod
    async def evaluate(self, request_id: str, query: str, answer: str,
                       context: str) -> EvaluationResult:
        """Run RAGAS evaluation for a query-answer pair."""
        ...
