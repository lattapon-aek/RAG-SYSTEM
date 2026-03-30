import os
import sys

import pytest
from unittest.mock import AsyncMock

_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from infrastructure.llm_entity_extractor import LLMEntityExtractor


@pytest.mark.asyncio
async def test_heuristic_extractor_finds_people_aliases_and_roles():
    extractor = LLMEntityExtractor(model="test-model", timeout=1.0)
    extractor._call_llm = AsyncMock(side_effect=AssertionError("LLM should not be called"))

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
    assert "ALIAS_OF" in rel_types
    assert "HAS_ROLE" in rel_types


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
