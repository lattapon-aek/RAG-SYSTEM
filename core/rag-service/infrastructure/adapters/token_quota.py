"""
Token Quota tracker — daily per-client token usage stored in Redis.

Key format : quota:tokens:{client_id}:{YYYY-MM-DD}
TTL        : 86400 seconds (auto-expire after 1 day)

Rate limit : rate_limit:{client_id}:{window_minute}
TTL        : 120 seconds (2-minute safety window)

Config via env:
  TOKEN_QUOTA_DEFAULT       — daily token limit per client (default: 100_000, 0 = unlimited)
  TOKEN_QUOTA_OVERRIDES     — JSON map of client_id → daily limit
                              e.g. '{"premium": 500000, "ci": 0}'
  RATE_LIMIT_DEFAULT_RPM    — requests per minute limit (default: 60, 0 = unlimited)
  RATE_LIMIT_OVERRIDES      — JSON map of client_id → RPM limit
"""
import json
import logging
import os
import time as _time
from datetime import date
from typing import Optional

logger = logging.getLogger(__name__)

_QUOTA_OVERRIDE_KEY = "quota:config:overrides"
_QUOTA_OVERRIDE_SOURCE_KEY = "quota:config:override_sources"
_RATE_LIMIT_OVERRIDE_KEY = "rate_limit:config:overrides"
_RATE_LIMIT_OVERRIDE_SOURCE_KEY = "rate_limit:config:override_sources"
_CACHE_TTL_SECONDS = 60
_persistent_override_cache: dict[tuple[str, str], tuple[Optional[int], float]] = {}
_pg_pool = None


def _get_config() -> tuple[int, dict]:
    """Read quota config from env at call time (not at import time)."""
    default = int(os.getenv("TOKEN_QUOTA_DEFAULT", "100000"))
    overrides: dict[str, int] = {}
    try:
        raw = os.getenv("TOKEN_QUOTA_OVERRIDES")
        if raw:
            overrides = json.loads(raw)
    except Exception:
        pass
    return default, overrides


def _get_rate_limit_config() -> tuple[int, dict]:
    default = int(os.getenv("RATE_LIMIT_DEFAULT_RPM", "60"))
    overrides: dict[str, int] = {}
    try:
        raw = os.getenv("RATE_LIMIT_OVERRIDES")
        if raw:
            overrides = json.loads(raw)
    except Exception:
        pass
    return default, overrides


async def _get_pg_pool():
    global _pg_pool
    if _pg_pool is not None:
        return _pg_pool

    dsn = os.getenv("POSTGRES_URL")
    if not dsn:
        return None

    try:
        import asyncpg
        _pg_pool = await asyncpg.create_pool(dsn)
    except Exception as exc:
        logger.debug("Persistent override DB pool init failed: %s", exc)
        return None
    return _pg_pool


async def _load_persistent_override(config_type: str, client_id: str) -> Optional[int]:
    cache_key = (config_type, client_id)
    cached = _persistent_override_cache.get(cache_key)
    if cached and (_time.time() - cached[1]) < _CACHE_TTL_SECONDS:
        return cached[0]

    pool = await _get_pg_pool()
    if not pool:
        _persistent_override_cache[cache_key] = (None, _time.time())
        return None

    try:
        row = await pool.fetchrow(
            """SELECT limit_value
               FROM client_limit_overrides
               WHERE config_type = $1 AND client_id = $2""",
            config_type, client_id,
        )
        value = int(row["limit_value"]) if row else None
        _persistent_override_cache[cache_key] = (value, _time.time())
        return value
    except Exception as exc:
        logger.debug("Persistent override lookup failed: %s", exc)
        _persistent_override_cache[cache_key] = (None, _time.time())
        return None


async def _record_admin_action(
    admin_user_id: str,
    action: str,
    resource_type: str,
    target_id: str,
    before_value: Optional[dict],
    after_value: Optional[dict],
    notes: Optional[str] = None,
) -> None:
    pool = await _get_pg_pool()
    if not pool:
        return
    try:
        await pool.execute(
            """INSERT INTO admin_action_log
               (admin_user_id, action, resource_type, target_id, before_value, after_value, notes)
               VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)""",
            admin_user_id,
            action,
            resource_type,
            target_id,
            json.dumps(before_value) if before_value is not None else None,
            json.dumps(after_value) if after_value is not None else None,
            notes,
        )
    except Exception as exc:
        logger.debug("Admin action audit insert failed: %s", exc)


async def record_admin_action(
    admin_user_id: Optional[str],
    action: str,
    resource_type: str,
    target_id: str,
    before_value: Optional[dict] = None,
    after_value: Optional[dict] = None,
    notes: Optional[str] = None,
) -> None:
    if not admin_user_id:
        return
    await _record_admin_action(
        admin_user_id=admin_user_id,
        action=action,
        resource_type=resource_type,
        target_id=target_id,
        before_value=before_value,
        after_value=after_value,
        notes=notes,
    )


async def _get_quota_limit(redis_client, client_id: str) -> tuple[int, bool, Optional[str]]:
    """Resolve quota limit for a client.

    Precedence:
      1. Redis override (admin-configured at runtime)
      2. ENV override
      3. Default ENV quota
    """
    default_quota, env_overrides = _get_config()

    try:
        if redis_client:
            raw = await redis_client.hget(_QUOTA_OVERRIDE_KEY, client_id)
            if raw is not None:
                source = await redis_client.hget(_QUOTA_OVERRIDE_SOURCE_KEY, client_id)
                return int(raw), True, source or "runtime"
    except Exception as exc:
        logger.debug("Quota override Redis read failed: %s", exc)

    persistent = await _load_persistent_override("quota", client_id)
    if persistent is not None:
        try:
            if redis_client:
                await redis_client.hset(_QUOTA_OVERRIDE_KEY, client_id, persistent)
                await redis_client.hset(_QUOTA_OVERRIDE_SOURCE_KEY, client_id, "persistent")
        except Exception as exc:
            logger.debug("Quota override Redis sync failed: %s", exc)
        return persistent, True, "persistent"

    if client_id in env_overrides:
        return int(env_overrides[client_id]), True, "env"

    return default_quota, False, None


async def _get_rate_limit_limit(redis_client, client_id: str) -> tuple[int, bool, Optional[str]]:
    default_rpm, env_overrides = _get_rate_limit_config()

    try:
        if redis_client:
            raw = await redis_client.hget(_RATE_LIMIT_OVERRIDE_KEY, client_id)
            if raw is not None:
                source = await redis_client.hget(_RATE_LIMIT_OVERRIDE_SOURCE_KEY, client_id)
                return int(raw), True, source or "runtime"
    except Exception as exc:
        logger.debug("Rate limit override Redis read failed: %s", exc)

    persistent = await _load_persistent_override("rate_limit", client_id)
    if persistent is not None:
        try:
            if redis_client:
                await redis_client.hset(_RATE_LIMIT_OVERRIDE_KEY, client_id, persistent)
                await redis_client.hset(_RATE_LIMIT_OVERRIDE_SOURCE_KEY, client_id, "persistent")
        except Exception as exc:
            logger.debug("Rate limit override Redis sync failed: %s", exc)
        return persistent, True, "persistent"

    if client_id in env_overrides:
        return int(env_overrides[client_id]), True, "env"

    return default_rpm, False, None


def _quota_key(client_id: str) -> str:
    today = date.today().isoformat()
    return f"quota:tokens:{client_id}:{today}"


async def check_and_increment_quota(
    redis_client,
    client_id: str,
    tokens_used: int,
) -> tuple[bool, int, int]:
    """
    Atomically increment token counter and check quota.

    Returns:
        (allowed, current_total, daily_limit)
        allowed=True  — request is within quota
        allowed=False — quota exhausted; current_total reflects post-increment value
    Falls back to allowing the request if Redis is unavailable.
    """
    limit, _, _ = await _get_quota_limit(redis_client, client_id)
    if limit == 0:
        # Unlimited
        return True, 0, 0

    key = _quota_key(client_id)
    try:
        current = await redis_client.incrby(key, tokens_used)
        if current == tokens_used:
            # First write today — set TTL
            await redis_client.expire(key, 86400)
        if current > limit:
            return False, current, limit
        return True, current, limit
    except Exception as exc:
        logger.debug("Token quota Redis error (fail-open): %s", exc)
        return True, 0, limit


async def check_rate_limit(redis_client, client_id: str) -> bool:
    """Increment per-minute request counter and check against RPM limit.

    Returns True if allowed, False if rate-limited.
    Fails open (returns True) if Redis is unavailable.
    """
    limit, _, _ = await _get_rate_limit_limit(redis_client, client_id)
    if limit == 0:
        return True  # unlimited
    window_minute = int(_time.time() / 60)
    key = f"rate_limit:{client_id}:{window_minute}"
    try:
        current = await redis_client.incr(key)
        if current == 1:
            await redis_client.expire(key, 120)  # 2-min TTL for safety
        return current <= limit
    except Exception as exc:
        logger.debug("Rate limit Redis error (fail-open): %s", exc)
        return True


async def get_quota_stats(redis_client, client_id: str) -> dict:
    """Return current token usage and limit for a client (for metrics endpoint)."""
    limit, has_override, override_source = await _get_quota_limit(redis_client, client_id)
    key = _quota_key(client_id)
    try:
        raw = await redis_client.get(key)
        used = int(raw) if raw else 0
    except Exception:
        used = 0
    return {
        "client_id": client_id,
        "tokens_used_today": used,
        "daily_limit": limit,
        "remaining": max(0, limit - used) if limit > 0 else None,
        "has_override": has_override,
        "override_source": override_source,
    }


async def get_rate_limit_config_stats(redis_client, client_id: str) -> dict:
    limit, has_override, override_source = await _get_rate_limit_limit(redis_client, client_id)
    current = 0
    try:
        window_minute = int(_time.time() / 60)
        raw = await redis_client.get(f"rate_limit:{client_id}:{window_minute}")
        current = int(raw) if raw else 0
    except Exception:
        current = 0
    return {
        "client_id": client_id,
        "requests_this_minute": current,
        "rpm_limit": limit,
        "remaining_this_minute": max(0, limit - current) if limit > 0 else None,
        "has_override": has_override,
        "override_source": override_source,
    }


async def _upsert_override(
    redis_client,
    redis_key: str,
    config_type: str,
    client_id: str,
    limit_value: int,
    admin_user_id: Optional[str] = None,
    notes: Optional[str] = None,
) -> None:
    pool = await _get_pg_pool()
    before = await _load_persistent_override(config_type, client_id)
    persisted = False
    if pool:
        await pool.execute(
            """INSERT INTO client_limit_overrides
               (config_type, client_id, limit_value, notes, updated_by, updated_at)
               VALUES ($1, $2, $3, $4, $5, NOW())
               ON CONFLICT (config_type, client_id)
               DO UPDATE SET
                   limit_value = EXCLUDED.limit_value,
                   notes = EXCLUDED.notes,
                   updated_by = EXCLUDED.updated_by,
                   updated_at = NOW()""",
            config_type, client_id, limit_value, notes, admin_user_id,
        )
        persisted = True
    _persistent_override_cache[(config_type, client_id)] = (limit_value, _time.time())
    if redis_client:
        await redis_client.hset(redis_key, client_id, limit_value)
        source_key = (
            _QUOTA_OVERRIDE_SOURCE_KEY
            if config_type == "quota"
            else _RATE_LIMIT_OVERRIDE_SOURCE_KEY
        )
        await redis_client.hset(source_key, client_id, "persistent" if persisted else "runtime")
    if admin_user_id:
        await _record_admin_action(
            admin_user_id=admin_user_id,
            action="set_override",
            resource_type=config_type,
            target_id=client_id,
            before_value={"limit_value": before} if before is not None else None,
            after_value={"limit_value": limit_value},
            notes=notes,
        )


async def _delete_override(
    redis_client,
    redis_key: str,
    config_type: str,
    client_id: str,
    admin_user_id: Optional[str] = None,
    notes: Optional[str] = None,
) -> None:
    pool = await _get_pg_pool()
    before = await _load_persistent_override(config_type, client_id)
    if pool:
        await pool.execute(
            "DELETE FROM client_limit_overrides WHERE config_type = $1 AND client_id = $2",
            config_type, client_id,
        )
    _persistent_override_cache[(config_type, client_id)] = (None, _time.time())
    if redis_client:
        await redis_client.hdel(redis_key, client_id)
        source_key = (
            _QUOTA_OVERRIDE_SOURCE_KEY
            if config_type == "quota"
            else _RATE_LIMIT_OVERRIDE_SOURCE_KEY
        )
        await redis_client.hdel(source_key, client_id)
    if admin_user_id and before is not None:
        await _record_admin_action(
            admin_user_id=admin_user_id,
            action="clear_override",
            resource_type=config_type,
            target_id=client_id,
            before_value={"limit_value": before},
            after_value=None,
            notes=notes,
        )


async def set_quota_override(
    redis_client,
    client_id: str,
    daily_limit: int,
    admin_user_id: Optional[str] = None,
    notes: Optional[str] = None,
) -> dict:
    """Persist a quota override in Postgres and sync it to Redis."""
    if daily_limit < 0:
        raise ValueError("daily_limit must be >= 0")
    await _upsert_override(
        redis_client,
        _QUOTA_OVERRIDE_KEY,
        "quota",
        client_id,
        daily_limit,
        admin_user_id=admin_user_id,
        notes=notes,
    )
    return await get_quota_stats(redis_client, client_id)


async def clear_quota_override(
    redis_client,
    client_id: str,
    admin_user_id: Optional[str] = None,
    notes: Optional[str] = None,
) -> dict:
    """Remove a quota override and fall back to env/default config."""
    await _delete_override(
        redis_client,
        _QUOTA_OVERRIDE_KEY,
        "quota",
        client_id,
        admin_user_id=admin_user_id,
        notes=notes,
    )
    return await get_quota_stats(redis_client, client_id)


async def set_rate_limit_override(
    redis_client,
    client_id: str,
    rpm_limit: int,
    admin_user_id: Optional[str] = None,
    notes: Optional[str] = None,
) -> dict:
    if rpm_limit < 0:
        raise ValueError("rpm_limit must be >= 0")
    await _upsert_override(
        redis_client,
        _RATE_LIMIT_OVERRIDE_KEY,
        "rate_limit",
        client_id,
        rpm_limit,
        admin_user_id=admin_user_id,
        notes=notes,
    )
    return await get_rate_limit_config_stats(redis_client, client_id)


async def clear_rate_limit_override(
    redis_client,
    client_id: str,
    admin_user_id: Optional[str] = None,
    notes: Optional[str] = None,
) -> dict:
    await _delete_override(
        redis_client,
        _RATE_LIMIT_OVERRIDE_KEY,
        "rate_limit",
        client_id,
        admin_user_id=admin_user_id,
        notes=notes,
    )
    return await get_rate_limit_config_stats(redis_client, client_id)


async def list_admin_actions(limit: int = 100, resource_type: Optional[str] = None) -> list[dict]:
    pool = await _get_pg_pool()
    if not pool:
        return []
    query = """SELECT id, admin_user_id, action, resource_type, target_id,
                      before_value, after_value, notes, created_at
               FROM admin_action_log"""
    params: list = []
    if resource_type:
        query += " WHERE resource_type = $1"
        params.append(resource_type)
    query += " ORDER BY created_at DESC LIMIT $" + str(len(params) + 1)
    params.append(limit)
    rows = await pool.fetch(query, *params)

    def _normalize_json(value):
        if isinstance(value, str):
            try:
                return json.loads(value)
            except Exception:
                return value
        return value

    return [
        {
            "id": str(r["id"]),
            "admin_user_id": r["admin_user_id"],
            "action": r["action"],
            "resource_type": r["resource_type"],
            "target_id": r["target_id"],
            "before_value": _normalize_json(r["before_value"]),
            "after_value": _normalize_json(r["after_value"]),
            "notes": r["notes"],
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
        }
        for r in rows
    ]
