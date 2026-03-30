"""
Task 3.5 — Unit tests สำหรับ Graph Service
ทดสอบ: entity deduplication, delete cascade, Neo4j unavailable → partial success

Usage:
    cd rag-system
    pip install spacy pytest pytest-asyncio
    python -m spacy download en_core_web_sm
    py -3.12 -m pytest tests/test_graph_service.py -v
"""
import sys
import os
import pytest
from unittest.mock import AsyncMock, MagicMock, patch, call

_GRAPH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "../core/graph-service")
)
if _GRAPH not in sys.path:
    sys.path.insert(0, _GRAPH)


# ---------------------------------------------------------------------------
# Task 3.5a — SpacyEntityExtractor: entity deduplication
# ---------------------------------------------------------------------------

class TestSpacyEntityExtractor:
    """Test entity deduplication by canonical name (lowercased)."""

    @pytest.fixture(autouse=True)
    def _skip_if_no_spacy(self):
        pytest.importorskip("spacy", reason="spacy not installed")
        try:
            import spacy
            spacy.load("en_core_web_sm")
        except OSError:
            pytest.skip("en_core_web_sm model not downloaded")

    @pytest.mark.asyncio
    async def test_duplicate_entity_merged(self):
        """Same entity mentioned twice → single entity with one source_doc_id."""
        from infrastructure.spacy_entity_extractor import SpacyEntityExtractor
        extractor = SpacyEntityExtractor("en_core_web_sm")

        text = "Alice works at Acme. Alice is a software engineer at Acme."
        entities, _ = await extractor.extract(text, document_id="doc-1")

        alice_entities = [e for e in entities if "alice" in e.id]
        assert len(alice_entities) == 1, "Alice should appear once (deduplicated)"
        assert "doc-1" in alice_entities[0].source_doc_ids

    @pytest.mark.asyncio
    async def test_entity_id_is_canonical_lowercase(self):
        """Entity id must be canonical (lowercased) name."""
        from infrastructure.spacy_entity_extractor import SpacyEntityExtractor
        extractor = SpacyEntityExtractor("en_core_web_sm")

        text = "Google is a technology company based in the United States."
        entities, _ = await extractor.extract(text, document_id="doc-2")

        for entity in entities:
            assert entity.id == entity.id.lower(), (
                f"Entity id '{entity.id}' is not lowercase"
            )

    @pytest.mark.asyncio
    async def test_label_mapping(self):
        """spaCy labels are mapped to canonical labels."""
        from infrastructure.spacy_entity_extractor import SpacyEntityExtractor
        extractor = SpacyEntityExtractor("en_core_web_sm")

        text = "Elon Musk founded Tesla in the United States."
        entities, _ = await extractor.extract(text, document_id="doc-3")

        labels = {e.label for e in entities}
        # All labels must be from the canonical set
        allowed = {"PERSON", "ORG", "LOCATION", "CONCEPT"}
        assert labels.issubset(allowed), f"Unexpected labels: {labels - allowed}"

    @pytest.mark.asyncio
    async def test_empty_text_returns_empty(self):
        """Empty text → no entities, no relations."""
        from infrastructure.spacy_entity_extractor import SpacyEntityExtractor
        extractor = SpacyEntityExtractor("en_core_web_sm")

        entities, relations = await extractor.extract("", document_id="doc-empty")
        assert entities == []
        assert relations == []

    @pytest.mark.asyncio
    async def test_source_doc_ids_populated(self):
        """Every extracted entity must reference the given document_id."""
        from infrastructure.spacy_entity_extractor import SpacyEntityExtractor
        extractor = SpacyEntityExtractor("en_core_web_sm")

        text = "OpenAI is an AI research company in San Francisco."
        entities, _ = await extractor.extract(text, document_id="my-doc")

        for entity in entities:
            assert "my-doc" in entity.source_doc_ids


# ---------------------------------------------------------------------------
# Task 3.5b — Neo4jGraphRepository (mocked): delete cascade & unavailability
# ---------------------------------------------------------------------------

class TestNeo4jGraphRepositoryMocked:
    """Test Neo4j repository behaviour using mocked Neo4j driver."""

    def _make_mock_driver(self):
        """Returns a mock AsyncDriver with a mock session."""
        mock_tx = AsyncMock()
        mock_tx.run = AsyncMock()

        mock_session = AsyncMock()
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)
        mock_session.execute_write = AsyncMock()
        mock_session.execute_read = AsyncMock()

        mock_driver = MagicMock()
        mock_driver.session = MagicMock(return_value=mock_session)
        mock_driver.close = AsyncMock()

        return mock_driver, mock_session

    @pytest.mark.asyncio
    async def test_delete_by_document_id_calls_session(self):
        """delete_by_document_id must open a session and execute a write transaction."""
        from infrastructure.neo4j_graph_repository import Neo4jGraphRepository

        mock_driver, mock_session = self._make_mock_driver()

        with patch("infrastructure.neo4j_graph_repository.AsyncGraphDatabase") as mock_gdb:
            mock_gdb.driver.return_value = mock_driver
            repo = Neo4jGraphRepository("bolt://localhost:7687", "neo4j", "password")
            repo._driver = mock_driver

            await repo.delete_by_document_id("doc-xyz")

        mock_session.execute_write.assert_called_once()

    @pytest.mark.asyncio
    async def test_store_entities_unavailable_raises(self):
        """ServiceUnavailable from Neo4j → GraphServiceUnavailableError raised."""
        from infrastructure.neo4j_graph_repository import Neo4jGraphRepository
        from domain.errors import GraphServiceUnavailableError
        from neo4j.exceptions import ServiceUnavailable

        mock_session = AsyncMock()
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)
        mock_session.execute_write = AsyncMock(
            side_effect=ServiceUnavailable("connection refused")
        )

        mock_driver = MagicMock()
        mock_driver.session = MagicMock(return_value=mock_session)

        with patch("infrastructure.neo4j_graph_repository.AsyncGraphDatabase") as mock_gdb:
            mock_gdb.driver.return_value = mock_driver
            repo = Neo4jGraphRepository("bolt://localhost:7687", "neo4j", "password")
            repo._driver = mock_driver

            with pytest.raises(GraphServiceUnavailableError):
                await repo.store_entities_and_relations([], [])


# ---------------------------------------------------------------------------
# Task 3.5c — ExtractEntitiesUseCase: Neo4j unavailable → partial success
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_extract_entities_use_case_graph_unavailable_partial_success():
    """When Neo4j is unavailable, ExtractEntitiesUseCase must NOT raise — partial success."""
    from application.extract_entities_use_case import ExtractEntitiesUseCase
    from domain.entities import Entity, Relation
    from domain.errors import GraphServiceUnavailableError

    # Extractor succeeds
    mock_extractor = AsyncMock()
    mock_extractor.extract = AsyncMock(return_value=(
        [Entity(id="alice", label="PERSON", name="Alice", source_doc_ids=["doc-1"])],
        [],
    ))

    # Repository is unavailable
    mock_repo = AsyncMock()
    mock_repo.store_entities_and_relations = AsyncMock(
        side_effect=GraphServiceUnavailableError("down")
    )

    uc = ExtractEntitiesUseCase(extractor=mock_extractor, repository=mock_repo)

    # Should NOT raise — partial success
    result = await uc.execute("Alice works at Acme.", document_id="doc-1")

    # entities were extracted even though storage failed
    assert result is not None
