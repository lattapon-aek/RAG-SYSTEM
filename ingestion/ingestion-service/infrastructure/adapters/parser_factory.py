from typing import Tuple
from application.ports.i_document_parser import IDocumentParser
from domain.entities import Document
from domain.errors import UnsupportedFileFormatError
from .pdf_parser import PdfParser
from .docx_parser import DocxParser
from .plain_text_parser import PlainTextParser

_MIME_TYPE_MAP = {
    "application/pdf": PdfParser,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": DocxParser,
    "text/plain": PlainTextParser,
    "text/markdown": PlainTextParser,
}


class _DispatchingParser(IDocumentParser):
    """Dispatches parse() to the correct parser based on mime_type."""

    async def parse(self, content: bytes, filename: str, mime_type: str) -> Tuple[str, Document]:
        parser_class = _MIME_TYPE_MAP.get(mime_type)
        if parser_class is None:
            # fallback to plain text for unknown types
            parser_class = PlainTextParser
        return await parser_class().parse(content, filename, mime_type)


class ParserFactory:
    @staticmethod
    def create(mime_type: str = None) -> IDocumentParser:
        """Return a dispatching parser (mime_type arg kept for backward compat)."""
        return _DispatchingParser()
