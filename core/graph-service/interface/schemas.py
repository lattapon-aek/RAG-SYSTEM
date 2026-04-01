from typing import List, Optional
from pydantic import BaseModel


# ---- Request schemas ----

class ExtractRequest(BaseModel):
    text: str
    document_id: str = "preview"
    namespace: str = "default"
    dry_run: bool = False


class GraphQueryRequest(BaseModel):
    query_text: str
    entity_names: List[str] = []
    max_hops: int = 2
    namespace: str = "default"


# ---- Response schemas ----

class ExtractResponse(BaseModel):
    document_id: str
    entity_count: int
    relation_count: int
    graph_stored: bool
    error: Optional[str] = None
    extraction_mode: str = "unknown"
    heuristic_blocks: int = 0
    llm_blocks: int = 0
    total_blocks: int = 0
    graph_extractor_backend: str = "unknown"
    graph_system_prompt_source: str = "unknown"
    graph_system_prompt_overridden: bool = False
    entities: Optional[List["EntityOut"]] = None
    relations: Optional[List["RelationOut"]] = None


class EntityOut(BaseModel):
    id: str
    label: str
    name: str
    source_doc_ids: List[str]


class RelationOut(BaseModel):
    id: str
    source_entity_id: str
    target_entity_id: str
    relation_type: str
    source_doc_id: str


class GraphQueryResponse(BaseModel):
    entities: List[EntityOut]
    relations: List[RelationOut]
    context_text: str


class StatsResponse(BaseModel):
    entity_count: int
    relation_count: int


class HealthResponse(BaseModel):
    status: str
