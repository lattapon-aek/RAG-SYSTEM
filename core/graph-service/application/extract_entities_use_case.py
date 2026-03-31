import logging
import re
from typing import List

from application.ports.i_entity_extractor import IEntityExtractor
from application.ports.i_graph_repository import IGraphRepository
from domain.entities import Entity, Relation
from domain.errors import GraphServiceUnavailableError

logger = logging.getLogger(__name__)


class ExtractEntitiesUseCase:
    def __init__(
        self,
        extractor: IEntityExtractor,
        repository: IGraphRepository,
    ):
        self._extractor = extractor
        self._repository = repository

    async def execute(
        self, text: str, document_id: str, namespace: str = "default", dry_run: bool = False
    ) -> dict:
        """Extract entities/relations from text and optionally persist to graph store.

        When dry_run=True, entities are extracted but NOT stored — used for preview.
        Returns partial success even when graph store is unavailable
        (does not block ingestion pipeline).
        """
        entities, relations = await self._extractor.extract(text, document_id)
        extraction_mode = getattr(self._extractor, "last_extraction_mode", "unknown")
        heuristic_blocks = int(getattr(self._extractor, "last_heuristic_blocks", 0) or 0)
        llm_blocks = int(getattr(self._extractor, "last_llm_blocks", 0) or 0)
        total_blocks = int(getattr(self._extractor, "last_total_blocks", 0) or 0)
        validation = self._validate_graph_quality(text, entities, relations)

        graph_stored = False
        error_message = None

        if not dry_run:
            graph_stored = True
            try:
                await self._repository.store_entities_and_relations(
                    entities, relations, namespace=namespace
                )
            except GraphServiceUnavailableError as exc:
                graph_stored = False
                error_message = str(exc)
                logger.error(
                    "Graph store unavailable — entities extracted but not persisted: %s",
                    exc,
                )

        result: dict = {
            "document_id": document_id,
            "entity_count": len(entities),
            "relation_count": len(relations),
            "graph_stored": graph_stored,
            "error": error_message,
            "extraction_mode": extraction_mode,
            "heuristic_blocks": heuristic_blocks,
            "llm_blocks": llm_blocks,
            "total_blocks": total_blocks,
            "validation_status": validation["status"],
            "validation_issues": validation["issues"],
            "validation_summary": validation["summary"],
        }

        if dry_run:
            result["entities"] = [e.__dict__ for e in entities]
            result["relations"] = [r.__dict__ for r in relations]

        return result

    @staticmethod
    def _validate_graph_quality(text: str, entities: List[Entity], relations: List[Relation]) -> dict:
        normalized = text.lower()
        person_count = sum(1 for entity in entities if entity.label == "PERSON")
        membership_count = sum(
            1
            for relation in relations
            if relation.relation_type in {"MEMBER_OF", "PART_OF"}
        )

        issues: list[str] = []
        team_like = bool(re.search(r"(?:\bทีม\b|\bteam\b)", normalized))

        if team_like and person_count >= 2 and membership_count == 0:
            issues.append("team_document_without_membership_relations")
        if team_like and person_count >= 2 and membership_count < max(1, person_count // 2):
            issues.append("sparse_membership_relations")

        status = "pass" if not issues else "needs_review"
        summary = "graph_quality_ok" if not issues else ",".join(issues)
        return {
            "status": status,
            "issues": issues,
            "summary": summary,
        }
