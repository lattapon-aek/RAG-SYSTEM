"""
RAGAS evaluation adapter — uses RAGAS framework when available,
falls back to simple heuristic scoring when not installed.
"""
import logging
import uuid
from datetime import datetime, timezone
from typing import List

from application.ports.i_ragas_evaluator import IRAGASEvaluator
from domain.entities import EvaluationResult

logger = logging.getLogger(__name__)


class RAGASAdapter(IRAGASEvaluator):
    """
    Wraps RAGAS evaluate() for faithfulness, answer_relevance,
    context_precision, context_recall.
    Falls back to NoOpEvaluator if ragas not installed.
    """

    def __init__(self, llm=None, embeddings=None):
        self._llm = llm
        self._embeddings = embeddings
        try:
            import ragas  # noqa: F401
            self._ragas_available = True
            logger.info("RAGAS available — using full evaluation")
        except ImportError:
            self._ragas_available = False
            logger.warning("RAGAS not installed — using heuristic fallback")

    async def evaluate(self, request_id: str, query: str, answer: str,
                       contexts: List[str]) -> EvaluationResult:
        if self._ragas_available:
            return await self._ragas_evaluate(request_id, query, answer, contexts)
        return self._heuristic_evaluate(request_id, query, answer, contexts)

    async def _ragas_evaluate(self, request_id: str, query: str,
                               answer: str, contexts: List[str]) -> EvaluationResult:
        try:
            from datasets import Dataset
            from ragas import evaluate
            from ragas.metrics import (
                faithfulness, answer_relevancy,
                context_precision, context_recall,
            )

            data = {
                "question": [query],
                "answer": [answer],
                "contexts": [contexts],
                "ground_truth": [answer],  # self-reference as fallback
            }
            dataset = Dataset.from_dict(data)
            result = evaluate(
                dataset,
                metrics=[faithfulness, answer_relevancy,
                         context_precision, context_recall],
            )
            scores = result.to_pandas().iloc[0]
            return EvaluationResult(
                id=str(uuid.uuid4()),
                request_id=request_id,
                faithfulness=float(scores.get("faithfulness", 0.0)),
                answer_relevance=float(scores.get("answer_relevancy", 0.0)),
                context_precision=float(scores.get("context_precision", 0.0)),
                context_recall=float(scores.get("context_recall", 0.0)),
                evaluated_at=datetime.now(timezone.utc),
            )
        except Exception as exc:
            logger.error("RAGAS evaluation failed: %s — using heuristic", exc)
            return self._heuristic_evaluate(request_id, query, answer, contexts)

    def _heuristic_evaluate(self, request_id: str, query: str,
                             answer: str, contexts: List[str]) -> EvaluationResult:
        """Simple word-overlap heuristic when RAGAS unavailable"""
        def overlap(a: str, b: str) -> float:
            wa, wb = set(a.lower().split()), set(b.lower().split())
            if not wa or not wb:
                return 0.0
            return len(wa & wb) / len(wa | wb)

        context_text = " ".join(contexts)
        faithfulness_score = overlap(answer, context_text)
        relevance_score = overlap(answer, query)
        precision = overlap(context_text, query)
        recall = overlap(query, context_text)

        return EvaluationResult(
            id=str(uuid.uuid4()),
            request_id=request_id,
            faithfulness=faithfulness_score,
            answer_relevance=relevance_score,
            context_precision=precision,
            context_recall=recall,
            evaluated_at=datetime.now(timezone.utc),
        )


class NoOpEvaluator(IRAGASEvaluator):
    """Pass-through evaluator returning neutral scores"""

    async def evaluate(self, request_id: str, query: str, answer: str,
                       contexts: List[str]) -> EvaluationResult:
        return EvaluationResult(
            id=str(uuid.uuid4()),
            request_id=request_id,
            faithfulness=1.0,
            answer_relevance=1.0,
            context_precision=1.0,
            context_recall=1.0,
            evaluated_at=datetime.now(timezone.utc),
        )
