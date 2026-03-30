from __future__ import annotations
from dataclasses import dataclass, field
from typing import List, Optional


@dataclass
class Entity:
    id: str                      # canonical name (lowercased)
    label: str                   # PERSON | ORG | LOCATION | CONCEPT
    name: str
    source_doc_ids: List[str] = field(default_factory=list)


@dataclass
class Relation:
    id: str
    source_entity_id: str
    target_entity_id: str
    relation_type: str           # e.g. "WORKS_AT", "LOCATED_IN"
    source_doc_id: str


@dataclass
class GraphQuery:
    query_text: str
    entity_names: List[str] = field(default_factory=list)
    max_hops: int = 2
    namespace: str = "default"


@dataclass
class GraphQueryResult:
    entities: List[Entity] = field(default_factory=list)
    relations: List[Relation] = field(default_factory=list)
    context_text: str = ""       # flattened text for RAG augmentation
