"""
Task 16.3 — Unit tests for Document Versioning.
Uses an in-memory stub to avoid requiring a real PostgreSQL.
"""
import sys
import os
import pytest
import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import List, Optional

_INGESTION = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _INGESTION not in sys.path:
    sys.path.insert(0, _INGESTION)


# ---------------------------------------------------------------------------
# In-memory stub for DocumentVersionRepository
# ---------------------------------------------------------------------------

@dataclass
class _VersionRow:
    id: str
    document_id: str
    version: int
    ingested_at: datetime
    chunk_count: int
    is_active: bool


class InMemoryVersionRepository:
    def __init__(self, max_versions: int = 3):
        self._store: List[_VersionRow] = []
        self._max_versions = max_versions
        self._id_counter = 0

    def _new_id(self) -> str:
        self._id_counter += 1
        return f"ver-{self._id_counter}"

    async def next_version(self, document_id: str) -> int:
        existing = [r for r in self._store if r.document_id == document_id]
        return (max(r.version for r in existing) if existing else 0) + 1

    async def create_version(self, document_id: str, version: int, chunk_count: int) -> _VersionRow:
        row = _VersionRow(
            id=self._new_id(),
            document_id=document_id,
            version=version,
            ingested_at=datetime.now(timezone.utc),
            chunk_count=chunk_count,
            is_active=False,
        )
        self._store.append(row)
        return row

    async def set_active(self, document_id: str, version_id: str) -> None:
        for r in self._store:
            if r.document_id == document_id:
                r.is_active = r.id == version_id

    async def list_versions(self, document_id: str) -> List[_VersionRow]:
        rows = [r for r in self._store if r.document_id == document_id]
        return sorted(rows, key=lambda r: r.version, reverse=True)

    async def get_version_by_id(self, version_id: str) -> Optional[_VersionRow]:
        return next((r for r in self._store if r.id == version_id), None)

    async def prune_old_versions(self, document_id: str, max_versions: int = None) -> int:
        max_v = max_versions or self._max_versions
        rows = [r for r in self._store if r.document_id == document_id]
        if len(rows) <= max_v:
            return 0
        # Delete oldest inactive versions
        inactive = sorted(
            [r for r in rows if not r.is_active], key=lambda r: r.version
        )
        to_delete = inactive[: len(rows) - max_v]
        for r in to_delete:
            self._store.remove(r)
        return len(to_delete)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_reingest_creates_new_version_not_delete_old():
    """Re-ingesting the same document creates a new version, old version remains."""
    repo = InMemoryVersionRepository()
    doc_id = "doc-abc"

    # First ingest
    v1_num = await repo.next_version(doc_id)
    v1 = await repo.create_version(doc_id, v1_num, chunk_count=5)
    await repo.set_active(doc_id, v1.id)

    # Second ingest (re-ingest with different content)
    v2_num = await repo.next_version(doc_id)
    v2 = await repo.create_version(doc_id, v2_num, chunk_count=7)
    await repo.set_active(doc_id, v2.id)

    versions = await repo.list_versions(doc_id)
    assert len(versions) == 2, "Both versions should exist"
    assert versions[0].version == 2  # newest first
    assert versions[1].version == 1


@pytest.mark.asyncio
async def test_active_version_flag_correct_after_reingest():
    """Only latest re-ingested version is active."""
    repo = InMemoryVersionRepository()
    doc_id = "doc-xyz"

    v1 = await repo.create_version(doc_id, 1, 4)
    await repo.set_active(doc_id, v1.id)
    v2 = await repo.create_version(doc_id, 2, 6)
    await repo.set_active(doc_id, v2.id)

    versions = await repo.list_versions(doc_id)
    active = [v for v in versions if v.is_active]
    assert len(active) == 1
    assert active[0].version == 2


@pytest.mark.asyncio
async def test_rollback_restores_previous_version_as_active():
    """Rollback sets older version as active."""
    repo = InMemoryVersionRepository()
    doc_id = "doc-rollback"

    v1 = await repo.create_version(doc_id, 1, 5)
    await repo.set_active(doc_id, v1.id)
    v2 = await repo.create_version(doc_id, 2, 8)
    await repo.set_active(doc_id, v2.id)

    # Rollback to v1
    await repo.set_active(doc_id, v1.id)

    versions = await repo.list_versions(doc_id)
    active = next(v for v in versions if v.is_active)
    assert active.version == 1
    assert active.id == v1.id


@pytest.mark.asyncio
async def test_prune_removes_oldest_inactive_when_exceeds_max():
    """Prune deletes oldest inactive versions when count exceeds max_versions."""
    repo = InMemoryVersionRepository(max_versions=3)
    doc_id = "doc-prune"

    versions = []
    for i in range(1, 5):  # 4 versions
        v = await repo.create_version(doc_id, i, chunk_count=i * 2)
        versions.append(v)
    await repo.set_active(doc_id, versions[-1].id)  # v4 active

    deleted = await repo.prune_old_versions(doc_id, max_versions=3)
    assert deleted == 1  # should prune 1 (v1)

    remaining = await repo.list_versions(doc_id)
    assert len(remaining) == 3
    remaining_versions = {v.version for v in remaining}
    assert 1 not in remaining_versions  # oldest pruned


@pytest.mark.asyncio
async def test_prune_does_not_delete_active_version():
    """Prune never deletes the active version."""
    repo = InMemoryVersionRepository(max_versions=2)
    doc_id = "doc-active-safe"

    v1 = await repo.create_version(doc_id, 1, 3)
    v2 = await repo.create_version(doc_id, 2, 5)
    v3 = await repo.create_version(doc_id, 3, 7)
    await repo.set_active(doc_id, v1.id)  # v1 is active (oldest!)

    await repo.prune_old_versions(doc_id, max_versions=2)

    remaining = await repo.list_versions(doc_id)
    # v1 (active) should still exist
    assert any(v.id == v1.id for v in remaining)


@pytest.mark.asyncio
async def test_version_numbers_increment_correctly():
    """Version numbers always increment by 1 from highest existing."""
    repo = InMemoryVersionRepository()
    doc_id = "doc-nums"

    for expected in [1, 2, 3]:
        num = await repo.next_version(doc_id)
        assert num == expected
        await repo.create_version(doc_id, num, chunk_count=1)


@pytest.mark.asyncio
async def test_get_version_by_id_returns_correct_row():
    repo = InMemoryVersionRepository()
    doc_id = "doc-get"
    v = await repo.create_version(doc_id, 1, 10)
    fetched = await repo.get_version_by_id(v.id)
    assert fetched is not None
    assert fetched.id == v.id
    assert fetched.chunk_count == 10
