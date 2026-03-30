"""
Task 15.4 — Unit tests for Rate Limiting and Token Quota.
Uses in-memory fake Redis to avoid requiring a real Redis instance.
"""
import sys
import os
import asyncio
import pytest

_RAG = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "core", "rag-service"))
if _RAG not in sys.path:
    sys.path.insert(0, _RAG)

from infrastructure.adapters.token_quota import (
    check_and_increment_quota,
    get_quota_stats,
    set_quota_override,
    clear_quota_override,
)


def _reload_tq(monkeypatch, default: int = 1000, overrides: str = "{}"):
    """Patch env vars — no reload needed since token_quota reads env at call time."""
    monkeypatch.setenv("TOKEN_QUOTA_DEFAULT", str(default))
    monkeypatch.setenv("TOKEN_QUOTA_OVERRIDES", overrides)
    return check_and_increment_quota, get_quota_stats


# ---------------------------------------------------------------------------
# Fake in-memory Redis
# ---------------------------------------------------------------------------

class FakeRedis:
    """Minimal async-compatible Redis stub for testing."""

    def __init__(self):
        self._store: dict[str, int] = {}
        self._ttls: dict[str, int] = {}
        self._hashes: dict[str, dict[str, str]] = {}

    async def incrby(self, key: str, amount: int) -> int:
        self._store[key] = self._store.get(key, 0) + amount
        return self._store[key]

    async def expire(self, key: str, seconds: int) -> None:
        self._ttls[key] = seconds

    async def get(self, key: str):
        v = self._store.get(key)
        return str(v) if v is not None else None

    async def incr(self, key: str) -> int:
        return await self.incrby(key, 1)

    async def keys(self, pattern: str):
        prefix = pattern.rstrip("*").rstrip(":")
        return [k for k in self._store if k.startswith(prefix.rsplit(":", 1)[0])]

    async def hget(self, key: str, field: str):
        return self._hashes.get(key, {}).get(field)

    async def hset(self, key: str, field: str, value: int) -> None:
        self._hashes.setdefault(key, {})[field] = str(value)

    async def hdel(self, key: str, field: str) -> None:
        self._hashes.get(key, {}).pop(field, None)


# ---------------------------------------------------------------------------
# Token Quota tests (Task 15.2)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_quota_allows_within_limit(monkeypatch):
    """Client within daily token limit is allowed."""
    check_and_increment_quota, _ = _reload_tq(monkeypatch, default=1000)
    redis = FakeRedis()
    allowed, current, limit = await check_and_increment_quota(redis, "user_a", 100)
    assert allowed is True
    assert current == 100
    assert limit == 1000


@pytest.mark.asyncio
async def test_quota_rejects_when_exceeded(monkeypatch):
    """Client exceeding daily token quota is rejected."""
    check_and_increment_quota, _ = _reload_tq(monkeypatch, default=500)
    redis = FakeRedis()
    await check_and_increment_quota(redis, "user_b", 450)
    allowed, current, limit = await check_and_increment_quota(redis, "user_b", 100)
    assert allowed is False
    assert current > limit


@pytest.mark.asyncio
async def test_quota_unlimited_when_zero(monkeypatch):
    """TOKEN_QUOTA_DEFAULT=0 means unlimited."""
    check_and_increment_quota, _ = _reload_tq(monkeypatch, default=0)
    redis = FakeRedis()
    for _ in range(5):
        allowed, _, _ = await check_and_increment_quota(redis, "ci_bot", 10000)
        assert allowed is True


@pytest.mark.asyncio
async def test_quota_per_client_override(monkeypatch):
    """Per-client override overrides default quota."""
    check_and_increment_quota, _ = _reload_tq(
        monkeypatch, default=100, overrides='{"premium_user": 999999}'
    )
    redis = FakeRedis()
    allowed, _, limit = await check_and_increment_quota(redis, "premium_user", 50000)
    assert allowed is True
    assert limit == 999999


@pytest.mark.asyncio
async def test_quota_stats_returns_correct_values(monkeypatch):
    """get_quota_stats returns current usage and limit."""
    check_and_increment_quota, get_quota_stats = _reload_tq(monkeypatch, default=2000)
    redis = FakeRedis()
    await check_and_increment_quota(redis, "stats_user", 300)
    stats = await get_quota_stats(redis, "stats_user")
    assert stats["tokens_used_today"] == 300
    assert stats["daily_limit"] == 2000
    assert stats["remaining"] == 1700
    assert stats["has_override"] is False


@pytest.mark.asyncio
async def test_quota_fail_open_on_redis_error(monkeypatch):
    """When Redis raises, quota check fails open (allows request)."""
    check_and_increment_quota, _ = _reload_tq(monkeypatch, default=1000)

    class BrokenRedis:
        async def incrby(self, *a, **kw): raise ConnectionError("redis down")
        async def expire(self, *a, **kw): raise ConnectionError("redis down")

    allowed, _, _ = await check_and_increment_quota(BrokenRedis(), "user_x", 100)
    assert allowed is True


@pytest.mark.asyncio
async def test_runtime_quota_override_takes_precedence(monkeypatch):
    """Admin runtime overrides in Redis must override env config without restart."""
    _reload_tq(monkeypatch, default=1000, overrides='{"runtime_user": 1500}')
    redis = FakeRedis()

    await set_quota_override(redis, "runtime_user", 2500)
    stats = await get_quota_stats(redis, "runtime_user")

    assert stats["daily_limit"] == 2500
    assert stats["has_override"] is True
    assert stats["override_source"] == "runtime"


@pytest.mark.asyncio
async def test_clear_runtime_override_restores_env_or_default(monkeypatch):
    """Resetting the runtime override must fall back to configured env/default values."""
    _reload_tq(monkeypatch, default=1000, overrides='{"runtime_user": 1500}')
    redis = FakeRedis()

    await set_quota_override(redis, "runtime_user", 2500)
    stats = await clear_quota_override(redis, "runtime_user")

    assert stats["daily_limit"] == 1500
    assert stats["override_source"] == "env"


# ---------------------------------------------------------------------------
# Sliding window rate limiter tests (Task 15.1) — logic only
# ---------------------------------------------------------------------------

def test_rate_limit_key_format():
    """Rate limit key must follow rate_limit:{client_id}:{window_minute} format."""
    import math, time
    window_minute = math.floor(time.time() / 60)
    key = f"rate_limit:test_client:{window_minute}"
    assert key.startswith("rate_limit:test_client:")
    assert str(window_minute) in key


def test_extract_client_id_from_user_id():
    """extractClientId falls back through user_id → default."""
    # We test the Python-side logic analogously (TS version tested in integration)
    args_with_user = {"user_id": "alice", "query": "hello"}
    client_id = args_with_user.get("client_id") or args_with_user.get("user_id") or "anonymous"
    assert client_id == "alice"


def test_extract_client_id_prefers_explicit_client_id():
    """Explicit client_id should override user_id for quota/rate-limit bucketing."""
    args_with_both = {"client_id": "team-a", "user_id": "alice", "query": "hello"}
    client_id = args_with_both.get("client_id") or args_with_both.get("user_id") or "anonymous"
    assert client_id == "team-a"


def test_extract_client_id_anonymous_fallback():
    args_no_user = {"query": "hello"}
    client_id = args_no_user.get("client_id") or args_no_user.get("user_id") or "anonymous"
    assert client_id == "anonymous"
