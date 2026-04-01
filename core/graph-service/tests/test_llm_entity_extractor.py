import os
import sys

import pytest
from unittest.mock import AsyncMock

_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from infrastructure.llm_entity_extractor import LLMEntityExtractor


@pytest.mark.asyncio
async def test_llm_first_extractor_finds_people_aliases_and_roles():
    extractor = LLMEntityExtractor(model="test-model", timeout=1.0)
    extractor._call_llm = AsyncMock(return_value="")

    text = """
## ลัทธพล (เอก) - Manager / ABAP Technical Lead

ลัทธพล ชื่อเล่น เอก (Email: lattapon.kea@dohome.co.th) ทำหน้าที่เป็น Manager และ ABAP Technical Lead

## ศุภกร (โจ้) - Senior ABAP Developer

ศุภกร ชื่อเล่น โจ้ (Email: Supakorn.Rak@dohome.co.th) เป็น Senior ABAP Developer
"""

    entities, relations = await extractor.extract(text, document_id="doc-1")
    ids = {entity.id for entity in entities}
    rel_types = {relation.relation_type for relation in relations}

    assert "ลัทธพล" in ids
    assert "เอก" in ids
    assert "ศุภกร" in ids
    assert "โจ้" in ids
    assert "abap" in ids
    extractor._call_llm.assert_awaited()
    assert "ALIAS_OF" in rel_types
    assert "HAS_ROLE" in rel_types


@pytest.mark.asyncio
async def test_llm_first_extractor_infers_team_membership_from_shared_context():
    extractor = LLMEntityExtractor(model="test-model", timeout=1.0)
    extractor._call_llm = AsyncMock(return_value="")

    text = """
## ทีม ABAP

ทีม ABAP ดูแลงานพัฒนาและงาน support ของระบบ SAP

ลัทธพล ชื่อเล่น เอก (Email: lattapon.kea@dohome.co.th) ทำหน้าที่เป็น Manager และ ABAP Technical Lead
ศุภกร ชื่อเล่น โจ้ (Email: Supakorn.Rak@dohome.co.th) เป็น Senior ABAP Developer
"""

    entities, relations = await extractor.extract(text, document_id="doc-team")
    ids = {entity.id for entity in entities}
    rel_types = {relation.relation_type for relation in relations}
    member_pairs = {
        (relation.source_entity_id, relation.target_entity_id, relation.relation_type)
        for relation in relations
    }

    assert "ลัทธพล" in ids
    assert "ศุภกร" in ids
    assert "abap" in ids
    assert "HAS_ROLE" in rel_types
    assert "MEMBER_OF" in rel_types
    extractor._call_llm.assert_awaited()
    assert ("ลัทธพล", "ทีม abap", "MEMBER_OF") in member_pairs
    assert ("ศุภกร", "ทีม abap", "MEMBER_OF") in member_pairs


@pytest.mark.asyncio
async def test_llm_first_extractor_maps_work_preferences_to_people_via_aliases():
    extractor = LLMEntityExtractor(model="test-model", timeout=1.0)
    extractor._call_llm = AsyncMock(return_value="")

    text = """
## ทีม ABAP

ศุภกร (โจ้) - Senior ABAP Developer
ศรัณญู (เปเล่) - ABAP Developer

- complexity สูง -> โจ้
- urgency สูง -> เปเล่
"""

    entities, relations = await extractor.extract(text, document_id="doc-work")
    rel_pairs = {
        (relation.source_entity_id, relation.target_entity_id, relation.relation_type)
        for relation in relations
    }

    extractor._call_llm.assert_awaited()
    assert ("ศุภกร", "complexity_high", "GOOD_FOR") in rel_pairs
    assert ("ศรัณญู", "urgent", "GOOD_FOR") in rel_pairs


@pytest.mark.asyncio
async def test_llm_first_uses_llm_output_before_fallback():
    extractor = LLMEntityExtractor(model="test-model", timeout=1.0)

    async def _fake_llm(_text: str) -> str:
        return (
            '{"entities":[{"id":"alice","label":"PERSON","name":"Alice"},{"id":"team","label":"ORG","name":"Team"}],'
            '"relations":[{"source":"alice","target":"team","type":"MEMBER_OF"}]}'
        )

    extractor._call_llm = _fake_llm

    entities, relations = await extractor.extract("Alice belongs to Team", document_id="doc-llm-first")
    ids = {entity.id for entity in entities}
    rel_types = {relation.relation_type for relation in relations}

    assert ids == {"alice", "team"}
    assert rel_types == {"MEMBER_OF"}
    assert extractor.last_extraction_mode == "llm"


@pytest.mark.asyncio
async def test_llm_fallback_normalizes_relation_vocabulary():
    extractor = LLMEntityExtractor(model="test-model", timeout=1.0)

    async def _fake_llm(_text: str) -> str:
        return (
            '{"entities":[{"id":"alice","label":"PERSON","name":"Alice"},{"id":"team","label":"CONCEPT","name":"Team"}],'
            '"relations":[{"source":"alice","target":"team","type":"belongs to"}]}'
        )

    extractor._call_llm = _fake_llm

    entities, relations = await extractor.extract("plain lowercase text only", document_id="doc-llm")
    ids = {entity.id for entity in entities}
    rel_types = {relation.relation_type for relation in relations}

    assert ids == {"alice", "team"}
    assert rel_types == {"MEMBER_OF"}


@pytest.mark.asyncio
async def test_llm_fallback_is_used_when_heuristics_find_nothing():
    extractor = LLMEntityExtractor(model="test-model", timeout=1.0)

    async def _fake_llm(_text: str) -> str:
        return (
            '{"entities":[{"id":"alice","label":"PERSON","name":"Alice"},{"id":"team","label":"CONCEPT","name":"Team"}],'
            '"relations":[{"source":"alice","target":"team","type":"PART_OF"}]}'
        )

    extractor._call_llm = _fake_llm

    entities, relations = await extractor.extract("plain lowercase text only", document_id="doc-2")
    ids = {entity.id for entity in entities}
    rel_types = {relation.relation_type for relation in relations}

    assert ids == {"alice", "team"}
    assert rel_types == {"PART_OF"}


def test_extractor_reports_backend_and_prompt_source(monkeypatch):
    monkeypatch.delenv("GRAPH_ENTITY_SYSTEM_PROMPT", raising=False)
    monkeypatch.setenv("GRAPH_EXTRACTOR_BACKEND", "llm")

    extractor = LLMEntityExtractor(model="test-model", timeout=1.0)

    assert extractor.last_graph_backend == "llm"
    assert extractor.last_graph_prompt_source == "default:few_shot_graph_prompt"
    assert extractor.last_graph_prompt_overridden is False

    monkeypatch.setenv("GRAPH_ENTITY_SYSTEM_PROMPT", "custom override")
    override_extractor = LLMEntityExtractor(model="test-model", timeout=1.0)

    assert override_extractor.last_graph_backend == "llm"
    assert override_extractor.last_graph_prompt_source == "env:GRAPH_ENTITY_SYSTEM_PROMPT"
    assert override_extractor.last_graph_prompt_overridden is True
