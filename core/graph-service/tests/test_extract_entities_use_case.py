import os
import sys

import pytest

_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from application.extract_entities_use_case import ExtractEntitiesUseCase
from domain.entities import Entity, Relation


class _DummyExtractor:
    def __init__(self, entities, relations):
        self._entities = entities
        self._relations = relations
        self.last_extraction_mode = "heuristic"
        self.last_heuristic_blocks = 1
        self.last_llm_blocks = 0
        self.last_total_blocks = 1
        self.last_graph_backend = "llm"
        self.last_graph_prompt_source = "default:few_shot_graph_prompt"
        self.last_graph_prompt_overridden = False

    async def extract(self, text: str, document_id: str):
        return self._entities, self._relations


class _DummyRepo:
    def __init__(self):
        self.stored = None

    async def store_entities_and_relations(self, entities, relations, namespace: str = "default"):
        self.stored = (entities, relations, namespace)


@pytest.mark.asyncio
async def test_validation_flags_team_docs_with_sparse_membership_relations():
    entities = [
        Entity(id="team abap", label="ORG", name="ทีม ABAP", source_doc_ids=["doc-1"]),
        Entity(id="alice", label="PERSON", name="Alice", source_doc_ids=["doc-1"]),
        Entity(id="bob", label="PERSON", name="Bob", source_doc_ids=["doc-1"]),
    ]
    relations = [
        Relation(
            id="rel-1",
            source_entity_id="alice",
            target_entity_id="team abap",
            relation_type="HAS_ROLE",
            source_doc_id="doc-1",
        )
    ]

    use_case = ExtractEntitiesUseCase(_DummyExtractor(entities, relations), _DummyRepo())
    result = await use_case.execute(
        text="ทีม ABAP ดูแลงานระบบ SAP",
        document_id="doc-1",
        namespace="sap",
        dry_run=True,
    )

    assert result["validation_status"] == "needs_review"
    assert "sparse_membership_relations" in result["validation_issues"]


@pytest.mark.asyncio
async def test_validation_passes_when_membership_relations_exist():
    entities = [
        Entity(id="team abap", label="ORG", name="ทีม ABAP", source_doc_ids=["doc-2"]),
        Entity(id="alice", label="PERSON", name="Alice", source_doc_ids=["doc-2"]),
        Entity(id="bob", label="PERSON", name="Bob", source_doc_ids=["doc-2"]),
    ]
    relations = [
        Relation(
            id="rel-1",
            source_entity_id="alice",
            target_entity_id="team abap",
            relation_type="MEMBER_OF",
            source_doc_id="doc-2",
        ),
        Relation(
            id="rel-2",
            source_entity_id="bob",
            target_entity_id="team abap",
            relation_type="MEMBER_OF",
            source_doc_id="doc-2",
        ),
    ]

    use_case = ExtractEntitiesUseCase(_DummyExtractor(entities, relations), _DummyRepo())
    result = await use_case.execute(
        text="ทีม ABAP มีสมาชิกสองคน",
        document_id="doc-2",
        namespace="sap",
        dry_run=True,
    )

    assert result["validation_status"] == "pass"
    assert result["validation_issues"] == []


@pytest.mark.asyncio
async def test_preview_exposes_graph_backend_and_prompt_source():
    entities = [
        Entity(id="team abap", label="ORG", name="ทีม ABAP", source_doc_ids=["doc-3"]),
        Entity(id="alice", label="PERSON", name="Alice", source_doc_ids=["doc-3"]),
    ]
    relations = [
        Relation(
            id="rel-1",
            source_entity_id="alice",
            target_entity_id="team abap",
            relation_type="MEMBER_OF",
            source_doc_id="doc-3",
        )
    ]

    use_case = ExtractEntitiesUseCase(_DummyExtractor(entities, relations), _DummyRepo())
    result = await use_case.execute(
        text="ทีม ABAP มี Alice เป็นสมาชิก",
        document_id="doc-3",
        namespace="sap",
        dry_run=True,
    )

    assert result["graph_extractor_backend"] == "llm"
    assert result["graph_system_prompt_source"] == "default:few_shot_graph_prompt"
    assert result["graph_system_prompt_overridden"] is False
