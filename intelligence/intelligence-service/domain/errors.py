"""Intelligence Service domain errors"""


class CandidateNotFoundError(Exception):
    """Raised when a knowledge candidate does not exist"""


class CandidateAlreadyDecidedError(Exception):
    """Raised when trying to approve/reject a candidate that is already in a terminal state"""


class EvaluationError(Exception):
    """Raised when RAGAS evaluation fails"""


class IngestionClientError(Exception):
    """Raised when the Ingestion Service HTTP call fails"""
