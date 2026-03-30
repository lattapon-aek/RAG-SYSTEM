"""
Async Circuit Breaker
States: CLOSED → (fail_max failures) → OPEN → (reset_timeout s) → HALF_OPEN → CLOSED/OPEN

Config (via env / rag-config.yaml):
  CIRCUIT_FAIL_MAX       default 5
  CIRCUIT_RESET_TIMEOUT  default 30  (seconds)

Redis persistence (db2):
  key: circuit:{name}:state   value: closed | open | half_open
  key: circuit:{name}:meta    hash  (failure_count, opened_at)
"""
import asyncio
import logging
import os
import time
from typing import Callable, Any, Dict, Optional

logger = logging.getLogger(__name__)

_FAIL_MAX = int(os.getenv("CIRCUIT_FAIL_MAX", "5"))
_RESET_TIMEOUT = float(os.getenv("CIRCUIT_RESET_TIMEOUT", "30"))

CLOSED    = "closed"
OPEN      = "open"
HALF_OPEN = "half_open"


class CircuitOpenError(Exception):
    """Raised when a call is rejected because the circuit is open."""
    def __init__(self, name: str):
        super().__init__(f"Circuit '{name}' is OPEN — call rejected")
        self.circuit_name = name


class AsyncCircuitBreaker:
    """
    Lightweight async-native circuit breaker with optional Redis state persistence.

    Usage:
        cb = AsyncCircuitBreaker("reranker", fail_max=5, reset_timeout=30)
        result = await cb.call(my_async_fn, arg1, kwarg=val)
    """

    def __init__(
        self,
        name: str,
        fail_max: int = _FAIL_MAX,
        reset_timeout: float = _RESET_TIMEOUT,
        redis_client=None,
    ):
        self.name = name
        self.fail_max = fail_max
        self.reset_timeout = reset_timeout
        self._redis = redis_client

        # In-memory state (source of truth for this process)
        self._state: str = CLOSED
        self._failure_count: int = 0
        self._opened_at: Optional[float] = None
        self._lock = asyncio.Lock()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def call(self, coro_fn: Callable, *args, **kwargs) -> Any:
        """Execute coro_fn if circuit allows; raise CircuitOpenError otherwise."""
        async with self._lock:
            await self._maybe_transition()

            if self._state == OPEN:
                raise CircuitOpenError(self.name)

            if self._state == HALF_OPEN:
                # Probe: one attempt allowed
                return await self._probe(coro_fn, *args, **kwargs)

        # CLOSED — normal call
        return await self._guarded_call(coro_fn, *args, **kwargs)

    @property
    def state(self) -> str:
        return self._state

    @property
    def failure_count(self) -> int:
        return self._failure_count

    def status(self) -> dict:
        return {
            "name": self.name,
            "state": self._state,
            "failure_count": self._failure_count,
            "opened_at": self._opened_at,
        }

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _maybe_transition(self):
        """OPEN → HALF_OPEN when reset_timeout has elapsed."""
        if self._state == OPEN and self._opened_at is not None:
            if time.monotonic() - self._opened_at >= self.reset_timeout:
                logger.info("Circuit '%s': OPEN → HALF_OPEN (probe)", self.name)
                self._state = HALF_OPEN
                await self._persist()

    async def _guarded_call(self, coro_fn, *args, **kwargs):
        try:
            result = await coro_fn(*args, **kwargs)
            await self._on_success()
            return result
        except Exception as exc:
            await self._on_failure(exc)
            raise

    async def _probe(self, coro_fn, *args, **kwargs):
        """Single probe call while HALF_OPEN — success closes, failure reopens."""
        try:
            result = await coro_fn(*args, **kwargs)
            await self._on_success()
            return result
        except Exception as exc:
            await self._trip(exc)
            raise

    async def _on_success(self):
        if self._state in (HALF_OPEN, CLOSED):
            if self._state == HALF_OPEN:
                logger.info("Circuit '%s': HALF_OPEN → CLOSED (probe succeeded)", self.name)
            self._state = CLOSED
            self._failure_count = 0
            self._opened_at = None
            await self._persist()

    async def _on_failure(self, exc: Exception):
        self._failure_count += 1
        logger.warning(
            "Circuit '%s': failure %d/%d — %s",
            self.name, self._failure_count, self.fail_max, exc,
        )
        if self._failure_count >= self.fail_max:
            await self._trip(exc)

    async def _trip(self, exc: Exception):
        logger.error(
            "Circuit '%s': CLOSED → OPEN after %d failures (last: %s)",
            self.name, self._failure_count, exc,
        )
        self._state = OPEN
        self._opened_at = time.monotonic()
        await self._persist()

    # ------------------------------------------------------------------
    # Redis persistence (db2)
    # ------------------------------------------------------------------

    async def _persist(self):
        if not self._redis:
            return
        try:
            state_key = f"circuit:{self.name}:state"
            meta_key  = f"circuit:{self.name}:meta"
            await self._redis.set(state_key, self._state)
            await self._redis.hset(meta_key, mapping={
                "failure_count": self._failure_count,
                "opened_at": self._opened_at or 0,
            })
        except Exception as exc:
            logger.debug("Circuit breaker Redis persist failed: %s", exc)


# ------------------------------------------------------------------
# Registry — one breaker per named service, shared across requests
# ------------------------------------------------------------------

_registry: Dict[str, AsyncCircuitBreaker] = {}


def get_breaker(name: str, redis_client=None) -> AsyncCircuitBreaker:
    """Return (or create) the circuit breaker for a given service name."""
    if name not in _registry:
        _registry[name] = AsyncCircuitBreaker(
            name=name,
            fail_max=_FAIL_MAX,
            reset_timeout=_RESET_TIMEOUT,
            redis_client=redis_client,
        )
    return _registry[name]


def all_statuses() -> Dict[str, dict]:
    """Return status dict for all registered circuit breakers."""
    return {name: cb.status() for name, cb in _registry.items()}
