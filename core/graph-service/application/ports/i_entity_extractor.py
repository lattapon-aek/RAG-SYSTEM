from abc import ABC, abstractmethod
from typing import List, Tuple

from domain.entities import Entity, Relation


class IEntityExtractor(ABC):
    @abstractmethod
    async def extract(
        self, text: str, document_id: str
    ) -> Tuple[List[Entity], List[Relation]]:
        """Extract entities and relations from text."""
        ...
