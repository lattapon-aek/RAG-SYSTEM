from abc import ABC, abstractmethod
from typing import Optional, Dict, Any


class IGraphServiceClient(ABC):
    @abstractmethod
    async def extract_entities(self, text: str, document_id: str,
                               namespace: str = "default",
                               dry_run: bool = False) -> Optional[Dict[str, Any]]:
        """Trigger entity extraction in Graph Service.

        When dry_run=True the service returns extracted entities/relations
        without persisting them.
        """
        ...
