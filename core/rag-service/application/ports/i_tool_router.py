from abc import ABC, abstractmethod
from typing import List
from domain.entities import ToolCall


class IToolRouter(ABC):
    @abstractmethod
    async def route(self, query: str, context: str) -> List[ToolCall]:
        """Route query through ReAct tool loop. LLM decides whether tools are needed."""
        ...
