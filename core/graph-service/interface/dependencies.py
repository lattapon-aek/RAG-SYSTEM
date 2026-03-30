import os
from functools import lru_cache

from application.extract_entities_use_case import ExtractEntitiesUseCase
from application.graph_query_use_case import GraphQueryUseCase
from application.ports.i_entity_extractor import IEntityExtractor
from infrastructure.spacy_entity_extractor import SpacyEntityExtractor
from infrastructure.neo4j_graph_repository import Neo4jGraphRepository

_repo: Neo4jGraphRepository | None = None
_extractor: IEntityExtractor | None = None


def get_repository() -> Neo4jGraphRepository:
    global _repo
    if _repo is None:
        _repo = Neo4jGraphRepository(
            uri=os.getenv("NEO4J_URI", "bolt://neo4j:7687"),
            user=os.getenv("NEO4J_USER", "neo4j"),
            password=os.getenv("NEO4J_PASSWORD", "password"),
        )
    return _repo


def get_extractor() -> IEntityExtractor:
    global _extractor
    if _extractor is None:
        backend = os.getenv("GRAPH_EXTRACTOR_BACKEND", "spacy").lower()
        if backend == "llm":
            from infrastructure.llm_entity_extractor import LLMEntityExtractor
            timeout = float(os.getenv("GRAPH_EXTRACTOR_TIMEOUT_SECONDS", "180"))
            _extractor = LLMEntityExtractor(timeout=timeout)
        else:
            model = os.getenv("SPACY_MODEL", "en_core_web_sm")
            _extractor = SpacyEntityExtractor(model_name=model)
    return _extractor


def get_extract_use_case() -> ExtractEntitiesUseCase:
    return ExtractEntitiesUseCase(
        extractor=get_extractor(),
        repository=get_repository(),
    )


def get_query_use_case() -> GraphQueryUseCase:
    return GraphQueryUseCase(repository=get_repository())
