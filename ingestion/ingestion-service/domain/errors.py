class DomainError(Exception):
    pass

class UnsupportedFileFormatError(DomainError):
    pass

class CorruptedFileError(DomainError):
    pass

class EmptyDocumentError(DomainError):
    pass

class DocumentNotFoundError(DomainError):
    pass

class EmbeddingServiceUnavailableError(DomainError):
    pass
