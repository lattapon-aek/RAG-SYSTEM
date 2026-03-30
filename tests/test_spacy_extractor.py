"""
Unit tests สำหรับ SpacyEntityExtractor ของ Graph Service
ต้องการ: pip install spacy && python -m spacy download en_core_web_sm

Usage:
    cd rag-system
    pytest tests/test_spacy_extractor.py -v
"""
import sys
import os
import pytest

# เพิ่ม graph-service root เข้า path
_GRAPH_ROOT = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "../core/graph-service")
)
if _GRAPH_ROOT not in sys.path:
    sys.path.insert(0, _GRAPH_ROOT)

from infrastructure.spacy_entity_extractor import SpacyEntityExtractor
from domain.errors import EntityExtractionError


SAMPLE_TEXT = (
    "Alice Smith works at Acme Corporation in Bangkok. "
    "Bob Johnson is her manager at Acme Corporation. "
    "They are developing a new product called RAGBot."
)


@pytest.fixture(scope="module")
def extractor():
    return SpacyEntityExtractor(model_name="en_core_web_sm")


@pytest.mark.asyncio
async def test_extract_returns_entities(extractor):
    """ต้องสกัด entities ออกมาได้"""
    entities, _ = await extractor.extract(SAMPLE_TEXT, document_id="doc-1")
    assert len(entities) > 0


@pytest.mark.asyncio
async def test_entity_labels_valid(extractor):
    """label ต้องเป็นหนึ่งใน PERSON | ORG | LOCATION | CONCEPT"""
    valid_labels = {"PERSON", "ORG", "LOCATION", "CONCEPT"}
    entities, _ = await extractor.extract(SAMPLE_TEXT, document_id="doc-1")
    for entity in entities:
        assert entity.label in valid_labels, f"Invalid label: {entity.label}"


@pytest.mark.asyncio
async def test_entity_id_is_canonical(extractor):
    """entity.id ต้องเป็น lowercased canonical name"""
    entities, _ = await extractor.extract(SAMPLE_TEXT, document_id="doc-1")
    for entity in entities:
        assert entity.id == entity.id.lower(), f"id '{entity.id}' ไม่ใช่ lowercase"


@pytest.mark.asyncio
async def test_entity_deduplication(extractor):
    """entity ที่ชื่อเดียวกันต้องถูก merge เป็น entity เดียว"""
    text = "Acme Corporation is a company. Acme Corporation was founded in 2000."
    entities, _ = await extractor.extract(text, document_id="doc-dedup")
    ids = [e.id for e in entities]
    assert len(ids) == len(set(ids)), "มี duplicate entity ids"


@pytest.mark.asyncio
async def test_source_doc_id_attached(extractor):
    """ทุก entity ต้องมี document_id ใน source_doc_ids"""
    entities, _ = await extractor.extract(SAMPLE_TEXT, document_id="doc-xyz")
    for entity in entities:
        assert "doc-xyz" in entity.source_doc_ids


@pytest.mark.asyncio
async def test_empty_text_returns_empty(extractor):
    """text ว่างต้องคืน empty lists"""
    entities, relations = await extractor.extract("", document_id="doc-empty")
    assert entities == []
    assert relations == []


@pytest.mark.asyncio
async def test_relations_reference_valid_entities(extractor):
    """ทุก relation ต้องอ้างอิง entity ที่มีอยู่จริง"""
    entities, relations = await extractor.extract(SAMPLE_TEXT, document_id="doc-1")
    entity_ids = {e.id for e in entities}
    for rel in relations:
        assert rel.source_entity_id in entity_ids, (
            f"source_entity_id '{rel.source_entity_id}' ไม่มีใน entities"
        )
        assert rel.target_entity_id in entity_ids, (
            f"target_entity_id '{rel.target_entity_id}' ไม่มีใน entities"
        )


def test_invalid_model_raises_error():
    """model ที่ไม่มีต้องโยน EntityExtractionError"""
    with pytest.raises(EntityExtractionError):
        SpacyEntityExtractor(model_name="xx_nonexistent_model_xx")
