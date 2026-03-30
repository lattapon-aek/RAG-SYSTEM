from dataclasses import dataclass, field
from typing import Optional, List
from datetime import datetime


@dataclass
class Document:
    id: str
    filename: str
    mime_type: str
    content_source: str = "upload"  # upload | web | db | rss
    source_url: Optional[str] = None
    source_hash: Optional[str] = None
    ingested_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    freshness_score: float = 1.0
    chunk_count: int = 0
    namespace: str = "default"


@dataclass
class Chunk:
    id: str
    document_id: str
    text: str
    token_count: int
    sequence_index: int
    chunk_type: str = "flat"  # flat | parent | child | semantic
    parent_chunk_id: Optional[str] = None
    namespace: str = "default"


@dataclass
class HierarchicalChunk:
    id: str
    document_id: str
    text: str
    token_count: int
    chunk_type: str  # parent | child | semantic
    sequence_index: int
    parent_chunk_id: Optional[str] = None
    embedding: Optional[List[float]] = None
    namespace: str = "default"


@dataclass
class ChunkWithEmbedding:
    chunk: Chunk
    embedding: List[float]
    ingested_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    content_source: Optional[str] = None
