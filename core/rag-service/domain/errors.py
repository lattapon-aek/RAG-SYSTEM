"""
RAG Service domain errors
"""


class RAGDomainError(Exception):
    """Base domain error"""


class EmptyQueryError(RAGDomainError):
    """Query is empty or whitespace"""


class QueryTimeoutError(RAGDomainError):
    """Query exceeded 30-second timeout"""


class NoRelevantInformationError(RAGDomainError):
    """Retrieval returned no relevant chunks"""


class LLMServiceUnavailableError(RAGDomainError):
    """LLM service is unavailable after retries"""


class EmbeddingServiceUnavailableError(RAGDomainError):
    """Embedding service is unavailable after retries"""


class VectorStoreUnavailableError(RAGDomainError):
    """Vector store is unavailable"""


class RerankerUnavailableError(RAGDomainError):
    """Reranker service is unavailable (fallback to vector results)"""


class DocumentNotFoundError(RAGDomainError):
    """Document not found"""


class QuotaExceededError(RAGDomainError):
    """Token quota exceeded for client"""
    def __init__(self, client_id: str, reset_at: str):
        self.client_id = client_id
        self.reset_at = reset_at
        super().__init__(f"Token quota exceeded for {client_id}, resets at {reset_at}")


class CacheError(RAGDomainError):
    """Semantic cache operation failed (non-fatal)"""
