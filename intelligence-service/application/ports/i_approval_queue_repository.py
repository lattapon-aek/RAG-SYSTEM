from abc import ABC, abstractmethod
from typing import List, Optional
from domain.entities import KnowledgeCandidate, CandidateStatus


class IApprovalQueueRepository(ABC):
    @abstractmethod
    async def add(self, candidate: KnowledgeCandidate) -> None: ...

    @abstractmethod
    async def get(self, candidate_id: str) -> Optional[KnowledgeCandidate]: ...

    @abstractmethod
    async def list_pending(self) -> List[KnowledgeCandidate]: ...

    @abstractmethod
    async def list_all(self, limit: int = 200) -> List[KnowledgeCandidate]: ...

    @abstractmethod
    async def update_status(self, candidate_id: str, status: CandidateStatus,
                            decided_by: Optional[str] = None) -> None: ...

    @abstractmethod
    async def list_expired(self) -> List[KnowledgeCandidate]: ...
