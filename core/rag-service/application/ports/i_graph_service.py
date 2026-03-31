from abc import ABC, abstractmethod
from typing import List, Dict, Any, Optional


class IGraphService(ABC):
    @abstractmethod
    async def query_related_entities(
        self,
        query: str,
        top_k: int = 10,
        namespace: str = "default",
        entity_names: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        """Return related entities for a query from the graph."""
        ...

    @abstractmethod
    async def delete_document(self, document_id: str,
                              namespace: str = "default") -> dict:
        """Delete graph entities/relations associated with a document in a namespace."""
        ...
