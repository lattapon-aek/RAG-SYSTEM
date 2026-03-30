import asyncio
from io import BytesIO
from uuid import uuid4
from typing import Tuple

from pypdf import PdfReader
from pypdf.errors import PdfReadError

from application.ports.i_document_parser import IDocumentParser
from domain.entities import Document
from domain.errors import CorruptedFileError, EmptyDocumentError


class PdfParser(IDocumentParser):
    async def parse(self, content: bytes, filename: str, mime_type: str) -> Tuple[str, Document]:
        def _extract() -> str:
            try:
                reader = PdfReader(BytesIO(content))
            except PdfReadError as e:
                raise CorruptedFileError(f"Failed to read PDF: {e}") from e

            if reader.is_encrypted:
                raise CorruptedFileError("PDF is encrypted and cannot be parsed")

            pages = []
            for page in reader.pages:
                try:
                    pages.append(page.extract_text() or "")
                except Exception as e:
                    raise CorruptedFileError(f"Failed to extract text from PDF page: {e}") from e

            return "\n".join(pages)

        text = await asyncio.to_thread(_extract)

        if not text or not text.strip():
            raise EmptyDocumentError(f"No text could be extracted from PDF: {filename}")

        document = Document(
            id=str(uuid4()),
            filename=filename,
            mime_type=mime_type,
            content_source="upload",
        )
        return text, document
