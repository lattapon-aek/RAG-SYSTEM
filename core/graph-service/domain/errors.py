class GraphServiceUnavailableError(Exception):
    """Raised when Neo4j or graph backend is unreachable."""
    def __init__(self, reason: str = ""):
        super().__init__(f"Graph service unavailable: {reason}")
        self.reason = reason


class EntityExtractionError(Exception):
    """Raised when entity extraction fails (e.g. spaCy model not loaded)."""
    def __init__(self, reason: str = ""):
        super().__init__(f"Entity extraction failed: {reason}")
        self.reason = reason
