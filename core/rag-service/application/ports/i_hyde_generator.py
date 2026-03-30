from abc import ABC, abstractmethod


class IHyDEGenerator(ABC):
    @abstractmethod
    async def generate_hypothetical_document(self, query: str) -> str:
        """Generate a hypothetical answer document for HyDE retrieval."""
        ...
