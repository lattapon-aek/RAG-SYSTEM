"""
SQLAlchemyAdapter — executes SQL queries via SQLAlchemy.
Credentials are never exposed in error messages.
"""
import logging
from typing import Any, Dict, List

from application.ports.i_structured_query_engine import IStructuredQueryEngine
from domain.entities import StructuredQueryResult
from domain.errors import StructuredQueryError

logger = logging.getLogger(__name__)


def _sanitize_dsn(dsn: str) -> str:
    """Remove password from DSN for safe logging."""
    import re
    return re.sub(r":[^:@]+@", ":***@", dsn)


class SQLAlchemyAdapter(IStructuredQueryEngine):
    async def execute(self, query: str, connection_string: str) -> StructuredQueryResult:
        try:
            import asyncio
            from sqlalchemy import create_engine, text

            def _run():
                engine = create_engine(connection_string)
                with engine.connect() as conn:
                    result = conn.execute(text(query))
                    columns = list(result.keys())
                    rows: List[Dict[str, Any]] = [dict(zip(columns, row)) for row in result]
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
            safe_msg = str(exc)
            # Strip any connection string that might appear in error
            if connection_string:
                safe_msg = safe_msg.replace(connection_string, "[REDACTED]")
            logger.error("SQL query failed: %s", safe_msg)
            raise StructuredQueryError(f"Query failed: {safe_msg}") from exc
