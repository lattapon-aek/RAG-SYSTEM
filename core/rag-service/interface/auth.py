"""
API key middleware.

- If RAG_SERVICE_API_KEY is set, requests must send that exact key via X-API-Key.
- If X-API-Key is provided and matches a DB-backed key in api_keys, the request is
  allowed and request.state.api_client_id is populated.
- If SERVICE_REQUIRE_DB_API_KEYS=true, requests without a valid DB key are rejected
  when no global env key is configured.
"""
import hashlib
import logging
import os
from typing import Optional
import asyncpg
from fastapi import Request
from fastapi.responses import JSONResponse

_EXCLUDED = {"/health", "/docs", "/openapi.json", "/redoc"}
_pg_pool = None
_logger = logging.getLogger(__name__)


def _is_true(value: str) -> bool:
    return value.lower() in {"1", "true", "yes", "on"}


async def _get_pg_pool():
    global _pg_pool
    if _pg_pool is not None:
        return _pg_pool
    dsn = os.getenv("POSTGRES_URL")
    if not dsn:
        return None
    try:
        _pg_pool = await asyncpg.create_pool(dsn)
    except Exception as exc:
        _logger.warning("API key DB pool init failed: %s", exc)
        return None
    return _pg_pool


def _hash_key(raw_key: str) -> str:
    return hashlib.sha256(raw_key.encode("utf-8")).hexdigest()


async def _lookup_db_api_key(provided_key: str) -> Optional[str]:
    pool = await _get_pg_pool()
    if not pool:
        return None

    hashed = _hash_key(provided_key)
    try:
        row = await pool.fetchrow(
            """SELECT id, client_id
               FROM api_keys
               WHERE hashed_key = $1 AND revoked_at IS NULL
               LIMIT 1""",
            hashed,
        )
        if not row:
            return None
        try:
            await pool.execute(
                "UPDATE api_keys SET last_used_at = NOW() WHERE id = $1",
                row["id"],
            )
        except Exception:
            pass
        return str(row["client_id"])
    except Exception as exc:
        _logger.warning("API key lookup failed: %s", exc)
        return None


async def _db_keys_required() -> bool:
    if not _is_true(os.getenv("SERVICE_REQUIRE_DB_API_KEYS", os.getenv("RAG_REQUIRE_DB_API_KEYS", "false"))):
        return False
    pool = await _get_pg_pool()
    if not pool:
        return False
    try:
        row = await pool.fetchrow(
            "SELECT EXISTS(SELECT 1 FROM api_keys WHERE revoked_at IS NULL) AS has_keys"
        )
        return bool(row["has_keys"]) if row else False
    except Exception as exc:
        _logger.warning("API key requirement probe failed: %s", exc)
        return False


async def api_key_middleware(request: Request, call_next):
    if request.url.path in _EXCLUDED:
        return await call_next(request)

    env_api_key = os.getenv("RAG_SERVICE_API_KEY", os.getenv("RAG_API_KEY", ""))
    provided = request.headers.get("X-API-Key", "").strip()

    if env_api_key:
        if provided != env_api_key:
            return JSONResponse(
                {"detail": "Invalid or missing API key"},
                status_code=401,
            )
        return await call_next(request)

    if provided:
        client_id = await _lookup_db_api_key(provided)
        if not client_id:
            return JSONResponse(
                {"detail": "Invalid or missing API key"},
                status_code=401,
            )
        request.state.api_client_id = client_id
        return await call_next(request)

    if await _db_keys_required():
        return JSONResponse(
            {"detail": "Invalid or missing API key"},
            status_code=401,
        )
    return await call_next(request)
