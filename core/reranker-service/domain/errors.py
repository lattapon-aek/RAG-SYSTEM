"""
Reranker Service — Domain Errors
"""


class RerankerError(Exception):
    """Base reranker error."""


class ModelLoadError(RerankerError):
    """Raised when the reranker model fails to load."""


class RerankError(RerankerError):
    """Raised when reranking fails."""
