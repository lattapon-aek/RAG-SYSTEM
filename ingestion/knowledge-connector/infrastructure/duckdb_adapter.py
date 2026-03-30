"""
DuckDBAdapter — executes queries on CSV/JSON/Parquet via DuckDB.
"""
import logging
from typing import Any, Dict, List

from application.ports.i_structured_query_engine import IStructuredQueryEngine
from domain.entities import StructuredQueryResult
from domain.errors import StructuredQueryError

logger = logging.getLogger(__name__)


class DuckDBAdapter(IStructuredQueryEngine):
    async def execute(self, query: str, connection_string: str = "") -> StructuredQueryResult:
        try:
            import asyncio
            import duckdb

            def _run():
                conn = duckdb.connect(database=":memory:")
                result = conn.execute(query)
                columns = [desc[0] for desc in result.description or []]
                rows_raw = result.fetchall()
                rows: List[Dict[str, Any]] = [dict(zip(columns, row)) for row in rows_raw]
                conn.close()
                return columns, rows

            loop = asyncio.get_event_loop()
            columns, rows = await loop.run_in_executor(None, _run)
            return StructuredQueryResult(
                query=query,
                rows=rows,
                columns=columns,
                row_count=len(rows),
            )
        except Exception as exc:
            logger.error("DuckDB query failed: %s", exc)
            raise StructuredQueryError(f"DuckDB query failed: {exc}") from exc
