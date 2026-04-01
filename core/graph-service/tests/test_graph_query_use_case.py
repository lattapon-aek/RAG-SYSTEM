"""
Unit tests for graph query shaping and summary abstraction.
"""
import os
import sys

import pytest

_GRAPH = os.path.abspath(os.path.join(os.path.dirname(__file__), "../"))
if _GRAPH not in sys.path:
    sys.path.insert(0, _GRAPH)

from application.graph_query_use_case import GraphQueryUseCase
from domain.entities import Entity, GraphQuery, GraphQueryResult, Relation


class _Repo:
    def __init__(self, result: GraphQueryResult):
        self.result = result
        self.calls = []

    async def query_related_entities(self, entity_names, max_hops=2, namespace="default"):
        self.calls.append({
            "entity_names": list(entity_names),
            "max_hops": max_hops,
            "namespace": namespace,
        })
        return self.result

    async def search_entities_by_text(self, query_text, max_hops=2, namespace="default"):
        self.calls.append({
            "search_text": query_text,
            "max_hops": max_hops,
            "namespace": namespace,
        })
        return self.result


@pytest.mark.asyncio
async def test_graph_query_use_case_extracts_multi_entity_candidates():
    repo = _Repo(GraphQueryResult(
        entities=[Entity(id="เอก", label="PERSON", name="เอก")],
        relations=[],
        context_text="",
    ))
    uc = GraphQueryUseCase(repo)

    result = await uc.execute(GraphQuery(query_text="เอกกับโจ้ทำงานกับใคร", entity_names=[], namespace="tenant-a"))

    assert result.entities[0].name == "เอก"
    assert repo.calls[0]["entity_names"] == ["เอก", "โจ้"]
    assert all("เอกกับโจ้ทำงานกับใคร" not in call.get("entity_names", []) for call in repo.calls)


def test_build_context_text_abstracts_relationships():
    neo4j = pytest.importorskip("neo4j")
    from infrastructure.neo4j_graph_repository import _build_context_text

    entities = [
        Entity(id="เอก", label="PERSON", name="เอก"),
        Entity(id="ทีม ABAP", label="ORG", name="ทีม ABAP"),
    ]
    relations = [
        Relation(
            id="r1",
            source_entity_id="เอก",
            target_entity_id="ทีม ABAP",
            relation_type="MEMBER_OF",
            source_doc_id="doc-1",
        ),
        Relation(
            id="r2",
            source_entity_id="เอก",
            target_entity_id="Manager",
            relation_type="HAS_ROLE",
            source_doc_id="doc-1",
        ),
    ]

    text = _build_context_text(entities, relations)

    assert "Graph Summary" in text
    assert "Entities:" in text
    assert "Relationships:" in text
    assert "PERSON: เอก" in text
    assert "ORG: ทีม ABAP" in text
    assert "เอก is a member of: ทีม ABAP" in text
    assert "เอก has role: Manager" in text
    assert "--[RELATION]-->" not in text
