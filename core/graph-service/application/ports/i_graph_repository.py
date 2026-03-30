from abc import ABC, abstractmethod
from typing import List

from domain.entities import Entity, Relation, GraphQueryResult


class IGraphRepository(ABC):
    @abstractmethod
    async def store_entities_and_relations(
        self,
        entities: List[Entity],
        relations: List[Relation],
        namespace: str = "default",
    ) -> None:
        """Upsert entities and relations into the graph store."""
        ...

    @abstractmethod
    async def query_related_entities(
        self,
        entity_names: List[str],
        max_hops: int = 2,
        namespace: str = "default",
    ) -> GraphQueryResult:
        """Traverse graph and return related entities/relations."""
        ...

    @abstractmethod
    async def search_entities_by_text(
        self,
        query_text: str,
        max_hops: int = 2,
        namespace: str = "default",
    ) -> GraphQueryResult:
        """Substring/contains search — fallback when exact-id match returns nothing."""
        ...

    @abstractmethod
    async def delete_by_document_id(self, document_id: str,
                                    namespace: str = "default") -> None:
        """Remove all nodes and edges sourced from the given document."""
        ...

    @abstractmethod
    async def list_namespaces(self) -> list:
        """Return per-namespace entity_count and relation_count."""
        ...

    @abstractmethod
    async def get_stats(self) -> dict:
        """Return entity_count, relation_count."""
        ...
