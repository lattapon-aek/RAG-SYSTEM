from uuid import uuid4
from typing import Tuple

from application.ports.i_document_parser import IDocumentParser
from domain.entities import Document
from domain.errors import EmptyDocumentError


class PlainTextParser(IDocumentParser):
    async def parse(self, content: bytes, filename: str, mime_type: str) -> Tuple[str, Document]:
        try:
            text = content.decode("utf-8")
        except UnicodeDecodeError:
            text = content.decode("latin-1")

        if not text or not text.strip():
            raise EmptyDocumentError(f"Document is empty: {filename}")

        document = Document(
            id=str(uuid4()),
            filename=filename,
            mime_type=mime_type,
            content_source="upload",
        )
        return text, document
