from abc import ABC, abstractmethod
from domain.entities import AuditLogEntry
from typing import List


class IAuditLogger(ABC):
    @abstractmethod
    async def log(self, entry: AuditLogEntry) -> None: ...

    @abstractmethod
    async def list_recent(self, limit: int = 50) -> List[AuditLogEntry]: ...
