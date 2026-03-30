"""
Task 18.4 — Unit tests สำหรับ Circuit Breaker

Usage:
    cd rag-system
    py -3.12 -m pytest tests/test_circuit_breaker.py -v
    (run separately — uses rag-service path)
"""
import sys
import os
import asyncio
import pytest

_RAG = os.path.abspath(os.path.join(os.path.dirname(__file__), "../core/rag-service"))
_INGESTION = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "../ingestion/ingestion-service")
)
for _p in [_INGESTION]:
    if _p in sys.path:
        sys.path.remove(_p)
for _mod in list(sys.modules.keys()):
    if _mod.split(".")[0] in ("application", "domain", "infrastructure", "interface"):
        del sys.modules[_mod]
if _RAG not in sys.path:
    sys.path.insert(0, _RAG)

from infrastructure.circuit_breaker import AsyncCircuitBreaker, CircuitOpenError, CLOSED, OPEN, HALF_OPEN


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _ok():
    return "success"

async def _fail():
    raise RuntimeError("service error")


def _make_cb(**kwargs) -> AsyncCircuitBreaker:
    defaults = dict(name="test", fail_max=3, reset_timeout=30)
    defaults.update(kwargs)
    return AsyncCircuitBreaker(**defaults)


# ---------------------------------------------------------------------------
# Task 18.4a — After fail_max failures circuit opens
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_circuit_opens_after_fail_max():
    """After fail_max consecutive failures, circuit must be OPEN."""
    cb = _make_cb(fail_max=3)

    for _ in range(3):
        with pytest.raises(RuntimeError):
            await cb.call(_fail)

    assert cb.state == OPEN


@pytest.mark.asyncio
async def test_circuit_open_rejects_calls_immediately():
    """Once OPEN, subsequent calls must raise CircuitOpenError without calling fn."""
    cb = _make_cb(fail_max=2)

    for _ in range(2):
        with pytest.raises(RuntimeError):
            await cb.call(_fail)

    assert cb.state == OPEN

    call_count = 0
    async def should_not_be_called():
        nonlocal call_count
        call_count += 1

    with pytest.raises(CircuitOpenError):
        await cb.call(should_not_be_called)

    assert call_count == 0, "Function must not be called when circuit is OPEN"


@pytest.mark.asyncio
async def test_circuit_stays_closed_on_success():
    """Successful calls must not increment failure count or open circuit."""
    cb = _make_cb(fail_max=3)

    for _ in range(10):
        result = await cb.call(_ok)
        assert result == "success"

    assert cb.state == CLOSED
    assert cb.failure_count == 0


@pytest.mark.asyncio
async def test_failure_count_resets_on_success():
    """Successful call after partial failures must reset failure_count."""
    cb = _make_cb(fail_max=5)

    for _ in range(3):
        with pytest.raises(RuntimeError):
            await cb.call(_fail)

    assert cb.failure_count == 3

    await cb.call(_ok)

    assert cb.failure_count == 0
    assert cb.state == CLOSED


# ---------------------------------------------------------------------------
# Task 18.4b — After reset_timeout, circuit enters HALF_OPEN and probe closes it
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_circuit_half_open_after_reset_timeout():
    """After reset_timeout seconds, OPEN circuit must transition to HALF_OPEN."""
    cb = _make_cb(fail_max=2, reset_timeout=0.05)  # 50ms for fast test

    for _ in range(2):
        with pytest.raises(RuntimeError):
            await cb.call(_fail)

    assert cb.state == OPEN

    await asyncio.sleep(0.1)  # exceed reset_timeout

    # Trigger transition check
    try:
        await cb.call(_ok)
    except Exception:
        pass

    # Should be CLOSED now (probe succeeded) or at least HALF_OPEN was entered
    assert cb.state in (CLOSED, HALF_OPEN)


@pytest.mark.asyncio
async def test_successful_probe_closes_circuit():
    """Successful probe while HALF_OPEN → circuit closes."""
    cb = _make_cb(fail_max=2, reset_timeout=0.05)

    for _ in range(2):
        with pytest.raises(RuntimeError):
            await cb.call(_fail)

    await asyncio.sleep(0.1)
    result = await cb.call(_ok)  # probe

    assert result == "success"
    assert cb.state == CLOSED
    assert cb.failure_count == 0


@pytest.mark.asyncio
async def test_failed_probe_reopens_circuit():
    """Failed probe while HALF_OPEN → circuit returns to OPEN."""
    cb = _make_cb(fail_max=2, reset_timeout=0.05)

    for _ in range(2):
        with pytest.raises(RuntimeError):
            await cb.call(_fail)

    await asyncio.sleep(0.1)

    with pytest.raises(RuntimeError):
        await cb.call(_fail)  # failed probe

    assert cb.state == OPEN


# ---------------------------------------------------------------------------
# Task 18.4c — Fallback behaviours (via mock clients)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_reranker_circuit_open_returns_stage1_results():
    """When reranker circuit is OPEN, fallback returns Stage 1 vector results sorted by score."""
    from domain.entities import RerankedResult
    from infrastructure.adapters.reranker_client import RerankerServiceClient

    # Force breaker to OPEN
    client = RerankerServiceClient.__new__(RerankerServiceClient)
    client._base_url = "http://unreachable:9999"
    client._breaker = AsyncCircuitBreaker(name="reranker_test", fail_max=1, reset_timeout=999)
    # Trip it immediately
    client._breaker._state = OPEN
    client._breaker._failure_count = 1

    candidates = [
        RerankedResult(chunk_id="c1", document_id="d1", text="a", score=0.5, original_rank=0, reranked_rank=0),
        RerankedResult(chunk_id="c2", document_id="d1", text="b", score=0.9, original_rank=1, reranked_rank=1),
        RerankedResult(chunk_id="c3", document_id="d1", text="c", score=0.3, original_rank=2, reranked_rank=2),
    ]

    result = await client.rerank("query", candidates, top_n=2)

    # Fallback: sorted by score descending, top_n=2
    assert len(result) == 2
    assert result[0].chunk_id == "c2"  # highest score


@pytest.mark.asyncio
async def test_graph_circuit_open_returns_empty():
    """When graph circuit is OPEN, fallback returns empty list (vector-only mode)."""
    from infrastructure.adapters.graph_service_client import GraphServiceClient

    client = GraphServiceClient.__new__(GraphServiceClient)
    client._base_url = "http://unreachable:9999"
    client._breaker = AsyncCircuitBreaker(name="graph_test", fail_max=1, reset_timeout=999)
    client._breaker._state = OPEN

    result = await client.query_related_entities("test query")

    assert result == [], "Graph circuit OPEN must return empty list (vector-only fallback)"


@pytest.mark.asyncio
async def test_intelligence_circuit_open_skips_background_evaluation():
    """Background intelligence calls should fail closed without crashing the request path."""
    from application.query_use_case import QueryUseCase

    use_case = QueryUseCase.__new__(QueryUseCase)
    use_case._intelligence_url = "http://unreachable:9999"
    use_case._intelligence_breaker = AsyncCircuitBreaker(
        name="intelligence_test", fail_max=1, reset_timeout=999
    )
    use_case._intelligence_breaker._state = OPEN
    use_case._intelligence_breaker._failure_count = 1

    await use_case._run_ragas_evaluation(
        request_id="req-1",
        query="test query",
        answer="test answer",
        contexts=["ctx"],
    )


# ---------------------------------------------------------------------------
# Task 18.4d — all_statuses reports all registered breakers
# ---------------------------------------------------------------------------

def test_all_statuses_includes_registered_breakers():
    """all_statuses() must return status dict for all registered circuit breakers."""
    from infrastructure.circuit_breaker import get_breaker, all_statuses

    get_breaker("svc-a")
    get_breaker("svc-b")

    statuses = all_statuses()
    assert "svc-a" in statuses
    assert "svc-b" in statuses
    for s in statuses.values():
        assert "state" in s
        assert s["state"] in (CLOSED, OPEN, HALF_OPEN)
        assert "failure_count" in s
