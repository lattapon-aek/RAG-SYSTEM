from abc import ABC, abstractmethod
from typing import Dict, Any


class IMetricsCollector(ABC):
    @abstractmethod
    async def record_query(self, request_id: str, latency_ms: float,
                           success: bool, from_cache: bool = False) -> None: ...

    @abstractmethod
    async def get_summary(self) -> Dict[str, Any]: ...
