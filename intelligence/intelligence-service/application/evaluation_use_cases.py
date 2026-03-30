"""
Evaluation use cases (RAGAS-based):
- EvaluateAnswerUseCase
- SampleQueryUseCase
- GetEvaluationSummaryUseCase
"""
import logging
import random
from typing import Optional

from domain.entities import EvaluationResult, EvaluationSummary
from domain.errors import EvaluationError
from application.ports.i_ragas_evaluator import IRAGASEvaluator
from application.ports.i_evaluation_repository import IEvaluationRepository

logger = logging.getLogger(__name__)

_DEFAULT_SAMPLE_RATE = 0.10


class EvaluateAnswerUseCase:
    """Run RAGAS evaluation for a single query-answer pair (async, non-blocking)."""

    def __init__(self, evaluator: IRAGASEvaluator, eval_repo: IEvaluationRepository):
        self._evaluator = evaluator
        self._eval_repo = eval_repo

    async def execute(self, request_id: str, query: str, answer: str,
                      contexts: list) -> EvaluationResult:
        try:
            result = await self._evaluator.evaluate(request_id, query, answer, contexts)
            await self._eval_repo.save(result)
            logger.info("Evaluation saved for request_id=%s faithfulness=%.2f",
                        request_id, result.faithfulness)
            return result
        except Exception as exc:
            logger.error("Evaluation failed for request_id=%s: %s", request_id, exc)
            raise EvaluationError(str(exc)) from exc


class SampleQueryUseCase:
    """Decide whether a query should be evaluated based on sample_rate."""

    def __init__(self, evaluate_use_case: EvaluateAnswerUseCase,
                 sample_rate: float = _DEFAULT_SAMPLE_RATE):
        self._evaluate = evaluate_use_case
        self._sample_rate = max(0.0, min(1.0, sample_rate))

    async def execute(self, request_id: str, query: str, answer: str,
                      contexts: list) -> Optional[EvaluationResult]:
        if random.random() > self._sample_rate:
            return None
        return await self._evaluate.execute(request_id, query, answer, contexts)


class GetEvaluationSummaryUseCase:
    def __init__(self, eval_repo: IEvaluationRepository):
        self._eval_repo = eval_repo

    async def execute(self) -> EvaluationSummary:
        return await self._eval_repo.get_summary()
