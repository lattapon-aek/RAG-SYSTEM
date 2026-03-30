"""
Task 8.4 — Unit tests สำหรับ Knowledge Connector
ทดสอบ: SearXNG unavailable, SQL syntax error (ไม่ expose credentials)

Usage:
    cd rag-system
    pip install httpx duckdb pytest pytest-asyncio
    py -3.12 -m pytest tests/test_knowledge_connector.py -v
"""
import sys
import os
import pytest
from unittest.mock import AsyncMock, patch, MagicMock

_KC = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "../ingestion/knowledge-connector")
)
# Remove conflicting paths and clear cached modules from other services
for _p in [
    os.path.abspath(os.path.join(os.path.dirname(__file__), "../ingestion/ingestion-service")),
    os.path.abspath(os.path.join(os.path.dirname(__file__), "../core/rag-service")),
    os.path.abspath(os.path.join(os.path.dirname(__file__), "../core/graph-service")),
]:
    if _p in sys.path:
        sys.path.remove(_p)

# Clear cached domain/application/infrastructure packages from other services
for _mod in list(sys.modules.keys()):
    if _mod.split(".")[0] in ("application", "domain", "infrastructure", "interface"):
        del sys.modules[_mod]

if _KC not in sys.path:
    sys.path.insert(0, _KC)


# ---------------------------------------------------------------------------
# Task 8.4a — SearXNG unavailable → SearchEngineUnavailableError
# ---------------------------------------------------------------------------

class TestSearXNGAdapter:

    @pytest.mark.asyncio
    async def test_searxng_unavailable_raises_error(self):
        """Connection failure → SearchEngineUnavailableError, not crash."""
        import httpx
        from infrastructure.searxng_adapter import SearXNGAdapter
        from domain.errors import SearchEngineUnavailableError

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client.get = AsyncMock(
                side_effect=httpx.ConnectError("Connection refused")
            )
            mock_client_cls.return_value = mock_client

            adapter = SearXNGAdapter(base_url="http://localhost:8080")
            with pytest.raises(SearchEngineUnavailableError):
                await adapter.search("test query")

    @pytest.mark.asyncio
    async def test_searxng_http_error_raises(self):
        """HTTP 500 from SearXNG → SearchEngineUnavailableError."""
        import httpx
        from infrastructure.searxng_adapter import SearXNGAdapter
        from domain.errors import SearchEngineUnavailableError

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_resp = MagicMock()
            mock_resp.raise_for_status = MagicMock(
                side_effect=httpx.HTTPStatusError(
                    "500 Server Error",
                    request=MagicMock(),
                    response=MagicMock(status_code=500),
                )
            )

            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client.get = AsyncMock(return_value=mock_resp)
            mock_client_cls.return_value = mock_client

            adapter = SearXNGAdapter(base_url="http://localhost:8080")
            with pytest.raises(SearchEngineUnavailableError):
                await adapter.search("test query")

    @pytest.mark.asyncio
    async def test_searxng_success_returns_results(self):
        """Successful SearXNG response → list of WebSearchResult."""
        from infrastructure.searxng_adapter import SearXNGAdapter
        from domain.entities import WebSearchResult

        fake_data = {
            "results": [
                {"title": "Result 1", "url": "https://example.com/1", "content": "snippet 1"},
                {"title": "Result 2", "url": "https://example.com/2", "content": "snippet 2"},
            ]
        }

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_resp = AsyncMock()
            mock_resp.raise_for_status = MagicMock()
            mock_resp.json = MagicMock(return_value=fake_data)

            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client.get = AsyncMock(return_value=mock_resp)
            mock_client_cls.return_value = mock_client

            adapter = SearXNGAdapter(base_url="http://localhost:8080")
            results = await adapter.search("rag system", max_results=5)

        assert len(results) == 2
        assert all(isinstance(r, WebSearchResult) for r in results)
        assert results[0].title == "Result 1"
        assert results[0].url == "https://example.com/1"

    @pytest.mark.asyncio
    async def test_searxng_respects_max_results(self):
        """max_results must cap the returned list."""
        from infrastructure.searxng_adapter import SearXNGAdapter

        fake_data = {
            "results": [
                {"title": f"R{i}", "url": f"https://example.com/{i}", "content": f"s{i}"}
                for i in range(10)
            ]
        }

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_resp = AsyncMock()
            mock_resp.raise_for_status = MagicMock()
            mock_resp.json = MagicMock(return_value=fake_data)

            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client.get = AsyncMock(return_value=mock_resp)
            mock_client_cls.return_value = mock_client

            adapter = SearXNGAdapter(base_url="http://localhost:8080")
            results = await adapter.search("rag", max_results=3)

        assert len(results) == 3


# ---------------------------------------------------------------------------
# Task 8.4b — SQL error → descriptive error, no credentials exposed
# ---------------------------------------------------------------------------

class TestDuckDBAdapter:

    @pytest.mark.asyncio
    async def test_syntax_error_raises_structured_query_error(self):
        """Bad SQL → StructuredQueryError (not raw exception)."""
        from infrastructure.duckdb_adapter import DuckDBAdapter
        from domain.errors import StructuredQueryError

        adapter = DuckDBAdapter()
        with pytest.raises(StructuredQueryError):
            await adapter.execute("SELECT * FROM nonexistent_table_xyz WHERE")

    @pytest.mark.asyncio
    async def test_error_message_does_not_expose_connection_string(self):
        """StructuredQueryError message must NOT include connection credentials."""
        from infrastructure.duckdb_adapter import DuckDBAdapter
        from domain.errors import StructuredQueryError

        sensitive = "postgresql://admin:s3cr3t@prod-db.internal:5432/mydb"
        adapter = DuckDBAdapter()

        try:
            await adapter.execute("INVALID SQL !!!", connection_string=sensitive)
        except StructuredQueryError as exc:
            error_msg = str(exc)
            assert "s3cr3t" not in error_msg, "Password must not appear in error message"
            assert "admin" not in error_msg or "postgresql" not in error_msg, (
                "Full connection string must not appear in error message"
            )

    @pytest.mark.asyncio
    async def test_valid_select_returns_result(self):
        """Valid DuckDB SQL → StructuredQueryResult with rows and columns."""
        pytest.importorskip("duckdb", reason="duckdb not installed")
        from infrastructure.duckdb_adapter import DuckDBAdapter
        from domain.entities import StructuredQueryResult

        adapter = DuckDBAdapter()
        result = await adapter.execute("SELECT 1 AS num, 'hello' AS greeting")

        assert isinstance(result, StructuredQueryResult)
        assert result.row_count == 1
        assert "num" in result.columns
        assert "greeting" in result.columns
        assert result.rows[0]["num"] == 1
        assert result.rows[0]["greeting"] == "hello"

    @pytest.mark.asyncio
    async def test_empty_result_set(self):
        """Query with no rows → empty rows list, correct columns."""
        pytest.importorskip("duckdb", reason="duckdb not installed")
        from infrastructure.duckdb_adapter import DuckDBAdapter

        adapter = DuckDBAdapter()
        result = await adapter.execute("SELECT 1 AS id WHERE 1=0")

        assert result.row_count == 0
        assert result.rows == []


# ---------------------------------------------------------------------------
# Task 8.4c — WebSearchUseCase: SearXNG unavailable does not crash pipeline
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_web_search_use_case_searxng_unavailable_returns_error():
    """When SearXNG is unavailable, WebSearchUseCase must raise, not silently return."""
    from application.use_cases import WebSearchUseCase
    from domain.errors import SearchEngineUnavailableError

    mock_engine = AsyncMock()
    mock_engine.search = AsyncMock(
        side_effect=SearchEngineUnavailableError("SearXNG down")
    )

    uc = WebSearchUseCase(engine=mock_engine)
    with pytest.raises(SearchEngineUnavailableError):
        await uc.execute(query="what is rag?", max_results=5)
