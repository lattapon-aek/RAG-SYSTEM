import logging

from application.ports.i_graph_repository import IGraphRepository
from domain.entities import GraphQuery, GraphQueryResult

logger = logging.getLogger(__name__)


class GraphQueryUseCase:
    def __init__(self, repository: IGraphRepository):
        self._repository = repository

    async def execute(self, query: GraphQuery) -> GraphQueryResult:
        # If no explicit entity names, derive candidates from query_text:
        # treat the full text as one name + each whitespace-split word as a candidate
        entity_names = query.entity_names
        if not entity_names and query.query_text.strip():
            text = query.query_text.strip()
            candidates = [text] + text.split()
            entity_names = list(dict.fromkeys(candidates))  # deduplicate, preserve order

        result = await self._repository.query_related_entities(
            entity_names=entity_names,
            max_hops=query.max_hops,
            namespace=query.namespace,
        )

        # If exact-id match returned nothing, try substring search as fallback
        if not result.entities and query.query_text.strip():
            result = await self._repository.search_entities_by_text(
                query_text=query.query_text.strip(),
                max_hops=query.max_hops,
                namespace=query.namespace,
            )

        return result
