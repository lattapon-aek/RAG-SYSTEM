from abc import ABC, abstractmethod
from domain.entities import EvaluationResult


class IRAGASEvaluator(ABC):
    @abstractmethod
    async def evaluate(self, request_id: str, query: str, answer: str,
                       contexts: list) -> EvaluationResult: ...
