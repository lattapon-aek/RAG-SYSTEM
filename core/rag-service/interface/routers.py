import json
import asyncio
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.responses import StreamingResponse

try:
    from interface.schemas import (
        QueryRequest, QueryResponse, CitationResponse,
        FeedbackRequest, DocumentResponse,
        MemoryGetRequest, MemorySaveRequest, MemoryProfileCreateRequest, HealthResponse,
        MetricsSummaryResponse, CircuitBreakerStatus, RateLimitStats,
        KnowledgeGapResponse, QuotaUpdateRequest, RateLimitUpdateRequest,
        RetrieveRequest, RetrieveResponse, RetrieveChunk, StageTimingInfo,
        NamespaceDescriptionRequest,
    )
    from interface.dependencies import get_query_use_case, get_doc_repo, get_memory_service
    from application.query_use_case import QueryRequest as UseCaseQueryRequest
    from domain.errors import EmptyQueryError, QueryTimeoutError, DocumentNotFoundError, QuotaExceededError
    from infrastructure.circuit_breaker import all_statuses
    from infrastructure.adapters.reranker_client import rrf_merge
except ImportError:
    from .schemas import (
        QueryRequest, QueryResponse, CitationResponse,
        FeedbackRequest, DocumentResponse,
        MemoryGetRequest, MemorySaveRequest, MemoryProfileCreateRequest, HealthResponse,
        MetricsSummaryResponse, CircuitBreakerStatus, RateLimitStats,
        KnowledgeGapResponse, QuotaUpdateRequest, RateLimitUpdateRequest,
        RetrieveRequest, RetrieveResponse, RetrieveChunk, StageTimingInfo,
        NamespaceDescriptionRequest,
    )
    from .dependencies import get_query_use_case, get_doc_repo, get_memory_service
    from ..application.query_use_case import QueryRequest as UseCaseQueryRequest
    from ..domain.errors import EmptyQueryError, QueryTimeoutError, DocumentNotFoundError, QuotaExceededError
    from ..infrastructure.circuit_breaker import all_statuses
    from ..infrastructure.adapters.reranker_client import rrf_merge

router = APIRouter()


@router.get("/health", response_model=HealthResponse)
async def health():
    return HealthResponse(status="healthy")


@router.get("/metrics/summary", response_model=MetricsSummaryResponse)
async def metrics_summary(doc_repo=Depends(get_doc_repo)):
    """Return aggregated metrics. Counts are best-effort from available stores."""
    doc_count = 0
    chunk_count = 0
    try:
        pool = await doc_repo._get_pool()
        count_row = await pool.fetchrow(
            "SELECT COUNT(*) AS doc_count, COALESCE(SUM(chunk_count), 0) AS chunk_count FROM documents"
        )
        if count_row:
            doc_count = int(count_row["doc_count"] or 0)
            chunk_count = int(count_row["chunk_count"] or 0)
    except Exception:
        pass

    query_volume = 0
    avg_retrieval_ms = 0.0
    avg_answer_latency_ms = 0.0
    avg_total_ms = 0.0
    cache_hit_rate = 0.0
    pending_approvals = 0
    try:
        pool = await doc_repo._get_pool()
        row = await pool.fetchrow(
            """SELECT
                COUNT(*) AS total,
                AVG(retrieval_latency_ms) AS avg_ret,
                AVG(answer_latency_ms) AS avg_answer,
                AVG(total_latency_ms) AS avg_total,
                COUNT(*) FILTER (WHERE from_cache = TRUE) AS cache_hits
               FROM interaction_log"""
        )
        if row and row["total"]:
            query_volume = int(row["total"])
            avg_retrieval_ms = float(row["avg_ret"] or 0.0)
            avg_answer_latency_ms = float(row["avg_answer"] or 0.0)
            avg_total_ms = float(row["avg_total"] or 0.0)
            cache_hits = int(row["cache_hits"] or 0)
            cache_hit_rate = cache_hits / query_volume if query_volume > 0 else 0.0
    except Exception:
        pass
    try:
        pool = await doc_repo._get_pool()
        prow = await pool.fetchrow(
            "SELECT COUNT(*) AS cnt FROM approval_queue WHERE status='pending'"
        )
        if prow:
            pending_approvals = int(prow["cnt"] or 0)
    except Exception:
        pass

    cb_statuses = [
        CircuitBreakerStatus(
            name=s["name"],
            state=s["state"],
            failure_count=s["failure_count"],
        )
        for s in all_statuses().values()
    ]

    avg_grounding_score = 0.0
    try:
        pool = await doc_repo._get_pool()
        grow = await pool.fetchrow(
            "SELECT AVG(grounding_score) AS avg_gs FROM interaction_log "
            "WHERE grounding_score IS NOT NULL"
        )
        if grow and grow["avg_gs"] is not None:
            avg_grounding_score = float(grow["avg_gs"])
    except Exception:
        pass

    knowledge_gaps_24h = 0
    try:
        pool = await doc_repo._get_pool()
        gaprow = await pool.fetchrow(
            "SELECT COUNT(*) AS cnt FROM knowledge_gap_log "
            "WHERE logged_at >= NOW() - INTERVAL '24 hours'"
        )
        if gaprow:
            knowledge_gaps_24h = int(gaprow["cnt"] or 0)
    except Exception:
        pass

    # Rate limit stats from Redis
    rate_limit_stats = None
    try:
        use_case = await get_query_use_case()
        redis = getattr(use_case, "_redis", None)
        if redis:
            import os
            default_rpm = int(os.getenv("RATE_LIMIT_DEFAULT_RPM", "60"))
            from datetime import datetime
            window_minute = int(datetime.utcnow().timestamp() / 60)
            keys = await redis.keys(f"rate_limit:*:{window_minute}")
            top_clients = []
            for key in keys[:10]:
                count = await redis.get(key)
                client = key.split(":")[1] if key.count(":") >= 2 else key
                top_clients.append({"client_id": client, "requests_this_minute": int(count or 0)})
            top_clients.sort(key=lambda x: x["requests_this_minute"], reverse=True)
            rate_limit_stats = RateLimitStats(
                active_clients=len(keys),
                default_rpm=default_rpm,
                top_clients=top_clients,
            )
    except Exception:
        pass

    return MetricsSummaryResponse(
        query_volume_total=query_volume,
        avg_retrieval_latency_ms=avg_retrieval_ms,
        avg_answer_latency_ms=avg_answer_latency_ms,
        avg_total_latency_ms=avg_total_ms,
        cache_hit_rate=cache_hit_rate,
        document_count=doc_count,
        chunk_count=chunk_count,
        pending_approvals=pending_approvals,
        circuit_breakers=cb_statuses,
        avg_grounding_score=avg_grounding_score,
        knowledge_gaps_24h=knowledge_gaps_24h,
        rate_limit=rate_limit_stats,
    )


@router.post("/query", response_model=QueryResponse)
async def query(request: Request, req: QueryRequest, use_case=Depends(get_query_use_case)):
    try:
        effective_client_id = getattr(request.state, "api_client_id", None) or req.client_id
        uc_req = UseCaseQueryRequest(
            query=req.query,
            namespace=req.namespace,
            namespaces=req.namespaces,
            client_id=effective_client_id,
            user_id=req.user_id,
            top_k=req.top_k,
            top_n_rerank=req.top_n_rerank,
            use_cache=req.use_cache,
            force_refresh=req.force_refresh,
            use_memory=req.use_memory,
            use_hyde=req.use_hyde,
            use_rewrite=req.use_rewrite,
            use_decompose=req.use_decompose,
            use_graph=req.use_graph,
        )
        result = await use_case.execute(uc_req)
        return QueryResponse(
            request_id=result.request_id,
            answer=result.answer,
            citations=[
                CitationResponse(
                    chunk_id=c.chunk_id,
                    document_id=c.document_id,
                    filename=c.filename,
                    text_snippet=c.text_snippet,
                    score=c.score,
                    sequence_index=c.sequence_index,
                )
                for c in result.citations
            ],
            graph_entities=result.graph_entities,
            graph_summary_texts=result.graph_summary_texts,
            rewritten_query=result.rewritten_query,
            hyde_used=result.hyde_used,
            sub_queries=result.sub_queries,
            from_cache=result.from_cache,
            retrieval_latency_ms=result.retrieval_latency_ms,
            answer_latency_ms=result.answer_latency_ms,
            total_latency_ms=result.total_latency_ms,
            grounding_score=result.grounding_score,
            low_confidence=result.low_confidence,
            stages=[StageTimingInfo(**s) for s in (result.stages or [])],
            memory_context_chars=result.memory_context_chars,
            knowledge_gap=result.knowledge_gap,
            top_rerank_score=result.top_rerank_score,
            graph_seed_names=result.graph_seed_names,
            graph_seed_source=result.graph_seed_source,
            graph_seed_strategy=result.graph_seed_strategy,
        )
    except EmptyQueryError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except QuotaExceededError as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"error": str(exc), "reset_at": exc.reset_at},
        )
    except QueryTimeoutError as exc:
        raise HTTPException(status_code=status.HTTP_504_GATEWAY_TIMEOUT, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail=str(exc))


@router.post("/query/stream")
async def query_stream(request: Request, req: QueryRequest, use_case=Depends(get_query_use_case)):
    """SSE streaming endpoint. Events: token → citations → done."""
    effective_client_id = getattr(request.state, "api_client_id", None) or req.client_id
    uc_req = UseCaseQueryRequest(
        query=req.query,
        namespace=req.namespace,
        namespaces=req.namespaces,
        client_id=effective_client_id,
        user_id=req.user_id,
        top_k=req.top_k,
        top_n_rerank=req.top_n_rerank,
        use_cache=req.use_cache,
        force_refresh=req.force_refresh,
        use_memory=req.use_memory,
        use_hyde=req.use_hyde,
        use_rewrite=req.use_rewrite,
        use_decompose=req.use_decompose,
        use_graph=req.use_graph,
    )

    async def event_generator():
        try:
            async for event in use_case.execute_stream(uc_req):
                yield event
        except Exception as exc:
            error_event = json.dumps({"type": "error", "message": str(exc)})
            yield f"data: {error_event}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/query/feedback")
async def submit_feedback(req: FeedbackRequest):
    # Stored via interaction_log — stub for now
    return {"status": "accepted", "request_id": req.request_id}


@router.post("/retrieve", response_model=RetrieveResponse)
async def retrieve(req: RetrieveRequest, doc_repo=Depends(get_doc_repo),
                   use_case=Depends(get_query_use_case)):
    """Retrieval-only endpoint — runs vector search + optional graph + optional rerank.
    Also optionally checks semantic cache, loads memory, and applies query intelligence.
    Does NOT call the LLM. Returns ranked chunks with full stage timing metadata."""
    import time as _time
    t0 = _time.monotonic()
    stages: list = []
    retrieval_query = req.query
    graph_seed_names: list[str] = []
    graph_seed_source = "empty"
    graph_seed_strategy = "none"

    def _stage(name: str, fired: bool, ms: float, **meta) -> None:
        stages.append(StageTimingInfo(stage=name, fired=fired,
                                      latency_ms=round(ms, 2), meta=meta))

    # ── Stage: graph seed extraction (optional, graph-only) ──────────────────
    if req.use_graph:
        t = _time.monotonic()
        graph_seed_names = await use_case.resolve_graph_seed_names(retrieval_query)
        graph_seed_source = getattr(use_case, "_last_graph_seed_source", "empty")
        graph_seed_strategy = getattr(use_case, "_last_graph_seed_strategy", "none")
        graph_seed_ms = (_time.monotonic() - t) * 1000
        _stage(
            "graph_seed",
            True,
            graph_seed_ms,
            seed_names=graph_seed_names,
            seed_count=len(graph_seed_names),
            seed_source=graph_seed_source,
            seed_strategy=graph_seed_strategy,
        )

    # ── Stage: embed (always) ─────────────────────────────────────────────────
    t = _time.monotonic()
    try:
        embedding = await use_case._embed.embed(req.query)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Embedding failed: {exc}")
    embed_ms = (_time.monotonic() - t) * 1000
    _stage("embed", True, embed_ms)

    # ── Stage: semantic cache (optional) ─────────────────────────────────────
    if req.use_cache and use_case._cache:
        t = _time.monotonic()
        try:
            cached = await use_case._cache.get(embedding, namespace=req.namespace)
        except Exception:
            cached = None
        cache_ms = (_time.monotonic() - t) * 1000
        if cached:
            _stage("cache", True, cache_ms, hit=True,
                   answer_len=len(getattr(cached, "answer", "") or ""))
            total_ms = round((_time.monotonic() - t0) * 1000, 1)
            return RetrieveResponse(
                query=req.query, chunks=[], graph_entities=[],
                retrieval_latency_ms=total_ms, total_chunks_before_rerank=0,
                stages=stages, cache_hit=True,
                cached_answer=(getattr(cached, "answer", "") or "")[:500],
                embed_latency_ms=round(embed_ms, 2),
                graph_seed_names=graph_seed_names,
                graph_seed_source=graph_seed_source,
                graph_seed_strategy=graph_seed_strategy,
            )
        _stage("cache", True, cache_ms, hit=False)

    # ── Stage: memory (optional) ──────────────────────────────────────────────
    memory_context_chars = 0
    if req.use_memory and req.user_id and use_case._memory:
        t = _time.monotonic()
        try:
            entries = await use_case._memory.get(req.user_id, req.query)
        except Exception:
            entries = []
        mem_ms = (_time.monotonic() - t) * 1000
        if entries:
            short_entries = [e for e in entries[:5]
                             if (e.get("metadata", {}) or {}).get("_save_target") != "composite"]
            long_entries  = [e for e in entries[:5]
                             if (e.get("metadata", {}) or {}).get("_save_target") == "composite"]
            memory_context_chars = sum(len(e.get("content", "")) for e in entries[:5])
            if short_entries:
                _stage("short_memory", True, mem_ms,
                       entry_count=len(short_entries), user_id=req.user_id)
            if long_entries:
                _stage("long_memory", True, 0.0,
                       entry_count=len(long_entries), user_id=req.user_id)
            if not short_entries and not long_entries:
                _stage("short_memory", True, mem_ms, entry_count=0, user_id=req.user_id)
        else:
            _stage("short_memory", False, mem_ms, user_id=req.user_id)

    # ── Stage: query intelligence (optional) ──────────────────────────────────
    rewritten_query: Optional[str] = None
    hyde_used = False
    if (req.use_rewrite or req.use_hyde):
        t = _time.monotonic()
        if req.use_rewrite and use_case._rewriter:
            try:
                retrieval_query = await use_case._rewriter.rewrite(req.query)
                rewritten_query = retrieval_query
            except Exception:
                pass
        if req.use_hyde and use_case._hyde:
            try:
                hyde_doc = await use_case._hyde.generate_hypothetical_document(retrieval_query)
                embedding = await use_case._embed.embed(hyde_doc)
                hyde_used = True
            except Exception:
                pass
        qintel_ms = (_time.monotonic() - t) * 1000
        _stage("q_intel", True, qintel_ms,
               rewritten=rewritten_query is not None, hyde=hyde_used)

    # ── Stage: vector search (multi-namespace fan-out) ────────────────────────
    effective_namespaces = req.namespaces if req.namespaces else [req.namespace]
    t = _time.monotonic()
    try:
        ns_vec_tasks = [
            use_case._vector_store.search(embedding, top_k=req.top_k, namespace=ns)
            for ns in effective_namespaces
        ]
        ns_vec_results = await asyncio.gather(*ns_vec_tasks, return_exceptions=True)
        all_vec_lists = [r for r in ns_vec_results if not isinstance(r, Exception) and r]
        if not all_vec_lists:
            vector_results = []
        elif len(all_vec_lists) > 1:
            vector_results = rrf_merge(all_vec_lists, top_n=req.top_k)
        else:
            vector_results = all_vec_lists[0][:req.top_k]
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Vector search failed: {exc}")
    vector_ms = (_time.monotonic() - t) * 1000
    _stage("vector", True, vector_ms, result_count=len(vector_results))
    total_before = len(vector_results)

    # ── Stage: graph augmentation (optional, multi-namespace fan-out) ─────────
    graph_entities: list = []
    graph_relations: list = []
    graph_summary_texts: list = []
    graph_ms = 0.0
    if req.use_graph and use_case._graph:
        t = _time.monotonic()
        try:
            ns_graph_tasks = [
                use_case._graph.query_related_entities(
                    retrieval_query,
                    top_k=req.top_k,
                    namespace=ns,
                    entity_names=graph_seed_names,
                )
                for ns in effective_namespaces
            ]
            ns_graph_results = await asyncio.gather(*ns_graph_tasks, return_exceptions=True)
            raw_all_entities: list = []
            raw_all_relations: list = []
            for r in ns_graph_results:
                if isinstance(r, Exception) or not r:
                    continue
                if isinstance(r, dict):
                    raw_all_entities.extend(r.get("entities", []) or [])
                    raw_all_relations.extend(r.get("relations", []) or [])
                    context_text = str(r.get("context_text", "") or "").strip()
                    if context_text:
                        graph_summary_texts.append(context_text)
                else:
                    raw_all_entities.extend(r)
            graph_entities = [
                {"name": e.get("name", ""), "type": e.get("type", e.get("label", ""))}
                if isinstance(e, dict) else {"name": str(e), "type": ""}
                for e in raw_all_entities
            ]
            graph_relations = [
                {
                    "source": rel.get("source", rel.get("source_entity", "")),
                    "target": rel.get("target", rel.get("target_entity", "")),
                    "relation_type": rel.get("relation_type", rel.get("type", "RELATED_TO")),
                }
                for rel in raw_all_relations
                if isinstance(rel, dict)
            ]
        except Exception:
            pass
        graph_ms = (_time.monotonic() - t) * 1000
        _stage("graph", True, graph_ms,
               entity_count=len(graph_entities),
               relation_count=len(graph_relations),
               seed_names=graph_seed_names,
               seed_count=len(graph_seed_names),
               seed_source=graph_seed_source,
               seed_strategy=graph_seed_strategy)

    # ── Stage: rerank (optional) ──────────────────────────────────────────────
    final_results = vector_results
    rerank_ms = 0.0
    top_score = 0.0
    if req.use_rerank and use_case._reranker and vector_results:
        t = _time.monotonic()
        try:
            reranked = await use_case._reranker.rerank(
                query=retrieval_query, results=vector_results, top_n=req.top_n_rerank
            )
            final_results = reranked if reranked else vector_results[:req.top_n_rerank]
        except Exception:
            final_results = vector_results[:req.top_n_rerank]
        rerank_ms = (_time.monotonic() - t) * 1000
        top_score = round(final_results[0].score, 4) if final_results else 0.0
        _stage("rerank", True, rerank_ms,
               result_count=len(final_results), top_score=top_score)
    else:
        final_results = vector_results[:req.top_n_rerank]
        top_score = round(final_results[0].score, 4) if final_results else 0.0

    knowledge_gap = (
        top_score < getattr(getattr(use_case, "_policy", None), "knowledge_gap_threshold", 0.3)
    )

    # ── Enrich chunks with filenames ──────────────────────────────────────────
    doc_map: dict = {}
    try:
        for ns in effective_namespaces:
            docs = await doc_repo.list_all(namespace=ns)
            doc_map.update({d.id: d.filename for d in docs})
    except Exception:
        pass

    chunks = [
        RetrieveChunk(
            chunk_id=r.chunk_id,
            document_id=r.document_id,
            filename=doc_map.get(r.document_id, r.document_id),
            text_snippet=r.text[:300],
            score=round(r.score, 4),
            sequence_index=getattr(r, "original_rank", i),
            stage="reranked" if req.use_rerank else "vector",
        )
        for i, r in enumerate(final_results)
    ]

    total_ms = round((_time.monotonic() - t0) * 1000, 1)
    return RetrieveResponse(
        query=req.query,
        chunks=chunks,
        graph_entities=graph_entities,
        graph_summary_texts=graph_summary_texts,
        graph_seed_names=graph_seed_names,
        retrieval_latency_ms=total_ms,
        total_chunks_before_rerank=total_before,
        stages=stages,
        cache_hit=False,
        memory_context_chars=memory_context_chars,
        rewritten_query=rewritten_query,
        hyde_used=hyde_used,
        embed_latency_ms=round(embed_ms, 2),
        vector_latency_ms=round(vector_ms, 2),
        graph_latency_ms=round(graph_ms, 2),
        rerank_latency_ms=round(rerank_ms, 2),
        knowledge_gap=knowledge_gap,
        top_rerank_score=top_score,
        graph_seed_source=graph_seed_source,
        graph_seed_strategy=graph_seed_strategy,
    )


@router.get("/documents", response_model=list)
async def list_documents(namespace: str = "default",
                         doc_repo=Depends(get_doc_repo)):
    docs = await doc_repo.list_all(namespace=namespace)
    return [
        DocumentResponse(
            id=d.id, filename=d.filename, content_type=d.content_type,
            namespace=d.namespace, chunk_count=d.chunk_count,
            ingested_at=str(d.ingested_at) if d.ingested_at else None,
        ).model_dump()
        for d in docs
    ]


@router.get("/namespaces")
async def list_namespaces(doc_repo=Depends(get_doc_repo)):
    """List all namespaces with document/chunk counts and description."""
    try:
        pool = await doc_repo._get_pool()
        rows = await pool.fetch(
            """SELECT d.namespace,
                      COUNT(*) AS document_count,
                      SUM(d.chunk_count) AS chunk_count,
                      nm.description
               FROM documents d
               LEFT JOIN namespace_metadata nm ON nm.namespace = d.namespace
               GROUP BY d.namespace, nm.description
               ORDER BY d.namespace"""
        )
        return [
            {
                "namespace": r["namespace"],
                "document_count": r["document_count"],
                "chunk_count": int(r["chunk_count"] or 0),
                "description": r["description"],
            }
            for r in rows
        ]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.put("/namespaces/{namespace}")
async def upsert_namespace_description(
    namespace: str,
    body: NamespaceDescriptionRequest,
    doc_repo=Depends(get_doc_repo),
):
    """Set or update the description for a namespace."""
    try:
        pool = await doc_repo._get_pool()
        await pool.execute(
            """INSERT INTO namespace_metadata (namespace, description, updated_at)
               VALUES ($1, $2, NOW())
               ON CONFLICT (namespace) DO UPDATE
               SET description = EXCLUDED.description, updated_at = NOW()""",
            namespace, body.description,
        )
        return {"namespace": namespace, "description": body.description}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.delete("/namespaces/{namespace}")
async def delete_namespace(
    namespace: str,
    request: Request,
    doc_repo=Depends(get_doc_repo),
    use_case=Depends(get_query_use_case),
):
    """Delete all data (documents, vectors, graph entities) for a namespace."""
    if namespace == "default":
        raise HTTPException(
            status_code=400, detail="Cannot delete the default namespace"
        )
    deleted_docs = 0
    deleted_chunks = 0
    deleted_entities = 0
    admin_user = request.headers.get("x-admin-user")
    try:
        # 1. Get all documents in namespace
        docs = await doc_repo.list_all(namespace=namespace)
        deleted_docs = len(docs)
        # 2. Delete vectors from ChromaDB
        for doc in docs:
            try:
                await use_case._vector_store.delete_by_document_id(doc.id, namespace)
                deleted_chunks += getattr(doc, "chunk_count", 0)
            except Exception:
                pass
        # 3. Delete documents from PostgreSQL + namespace metadata
        pool = await doc_repo._get_pool()
        await pool.execute("DELETE FROM documents WHERE namespace=$1", namespace)
        await pool.execute("DELETE FROM namespace_metadata WHERE namespace=$1", namespace)
        # 4. Delete graph entities from Neo4j (fire-and-forget)
        if use_case._graph:
            try:
                graph_result = await use_case._graph.delete_namespace(namespace)
                deleted_entities = graph_result.get("deleted_entities", 0)
            except Exception:
                pass
        # 5. Invalidate semantic cache entries for this namespace
        if use_case._cache:
            try:
                await use_case._cache.invalidate_by_namespace(namespace)
            except Exception:
                pass
        from infrastructure.adapters.token_quota import record_admin_action
        await record_admin_action(
            admin_user_id=admin_user,
            action="delete_namespace",
            resource_type="namespace",
            target_id=namespace,
            before_value={
                "deleted_documents": deleted_docs,
                "deleted_chunks": deleted_chunks,
                "deleted_graph_entities": deleted_entities,
            },
            after_value=None,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    return {
        "status": "deleted",
        "namespace": namespace,
        "deleted_documents": deleted_docs,
        "deleted_chunks": deleted_chunks,
        "deleted_graph_entities": deleted_entities,
    }


@router.delete("/documents/{document_id}")
async def delete_document(document_id: str,
                           namespace: str = "default",
                           request: Request = None,
                           doc_repo=Depends(get_doc_repo),
                           use_case=Depends(get_query_use_case)):
    doc = await doc_repo.find_by_id(document_id, namespace=namespace)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    admin_user = request.headers.get("x-admin-user") if request else None
    before_value = {
        "filename": doc.filename,
        "namespace": doc.namespace,
        "chunk_count": doc.chunk_count,
    }
    await use_case._vector_store.delete_by_document_id(document_id, namespace=namespace)
    if use_case._graph:
        try:
            await use_case._graph.delete_document(document_id, namespace=namespace)
        except Exception:
            pass
    if use_case._cache:
        try:
            await use_case._cache.invalidate_by_document(document_id)
        except Exception:
            pass
    await doc_repo.delete(document_id, namespace=namespace)
    from infrastructure.adapters.token_quota import record_admin_action
    await record_admin_action(
        admin_user_id=admin_user,
        action="delete_document",
        resource_type="document",
        target_id=document_id,
        before_value=before_value,
        after_value=None,
    )
    return {"status": "deleted", "document_id": document_id, "namespace": namespace}


# Memory endpoints
@router.post("/memory/get")
async def memory_get(req: MemoryGetRequest,
                     memory=Depends(get_memory_service)):
    if not memory:
        raise HTTPException(status_code=503, detail="Memory service not enabled")
    entries = await memory.get(req.user_id, req.query)
    return {"entries": entries}


@router.post("/memory/save")
async def memory_save(req: MemorySaveRequest,
                      memory=Depends(get_memory_service),
                      doc_repo=Depends(get_doc_repo)):
    if not memory:
        raise HTTPException(status_code=503, detail="Memory service not enabled")
    memory_id = await memory.save(req.user_id, req.content, req.metadata)
    try:
        pool = await doc_repo._get_pool()
        await pool.execute(
            """INSERT INTO memory_profiles (user_id, label, notes)
               VALUES ($1, NULL, NULL)
               ON CONFLICT (user_id) DO NOTHING""",
            req.user_id,
        )
    except Exception:
        pass
    return {"memory_id": memory_id}


@router.post("/memory/users")
async def memory_profile_create(req: MemoryProfileCreateRequest,
                                doc_repo=Depends(get_doc_repo)):
    user_id = req.user_id.strip()
    if not user_id:
        raise HTTPException(status_code=400, detail="user_id is required")
    try:
        pool = await doc_repo._get_pool()
        existing = await pool.fetchrow(
            """
            SELECT 1 AS exists_flag
            FROM (
                SELECT user_id FROM memory_profiles WHERE user_id = $1
                UNION
                SELECT user_id FROM user_memory WHERE user_id = $1
            ) AS existing_profiles
            LIMIT 1
            """,
            user_id,
        )
        if existing:
            raise HTTPException(status_code=409, detail=f"Profile {user_id} already exists")
        row = await pool.fetchrow(
            """INSERT INTO memory_profiles (user_id, label, notes)
               VALUES ($1, $2, $3)
               RETURNING user_id, label, notes, created_at, created_by""",
            user_id,
            req.label.strip() if isinstance(req.label, str) and req.label.strip() else None,
            req.notes.strip() if isinstance(req.notes, str) and req.notes.strip() else None,
        )
        return {
            "user_id": row["user_id"],
            "label": row["label"],
            "notes": row["notes"],
            "created_at": row["created_at"].isoformat() if row["created_at"] else None,
            "created_by": row["created_by"],
        }
    except Exception as exc:
        if getattr(exc, "status_code", None) == 409:
            raise
        if getattr(exc, "code", None) == "23505":
            raise HTTPException(status_code=409, detail=f"Profile {user_id} already exists")
        raise HTTPException(status_code=500, detail=str(exc))


@router.delete("/memory/users/{user_id}")
async def memory_profile_delete(user_id: str,
                                 memory=Depends(get_memory_service),
                                 doc_repo=Depends(get_doc_repo)):
    normalized = user_id.strip()
    if not normalized:
        raise HTTPException(status_code=400, detail="user_id is required")

    deleted_entries = 0
    if memory:
        try:
            existing_entries = await memory.list(normalized)
            for entry in existing_entries:
                entry_id = entry.get("id") if isinstance(entry, dict) else getattr(entry, "id", None)
                if not entry_id:
                    continue
                await memory.delete(normalized, str(entry_id))
                deleted_entries += 1
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc))

    try:
        pool = await doc_repo._get_pool()
        await pool.execute("DELETE FROM memory_profiles WHERE user_id = $1", normalized)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    return {
        "status": "deleted",
        "user_id": normalized,
        "deleted_entries": deleted_entries,
    }


@router.get("/memory/stats")
async def memory_stats(doc_repo=Depends(get_doc_repo)):
    """Return aggregate memory stats: short-term (Redis) and long-term (Postgres)."""
    # Long-term from Postgres
    long_users = 0
    long_entries = 0
    try:
        pool = await doc_repo._get_pool()
        row = await pool.fetchrow(
            "SELECT COUNT(DISTINCT user_id) AS users, COUNT(*) AS entries FROM user_memory"
        )
        if row:
            long_users = int(row["users"] or 0)
            long_entries = int(row["entries"] or 0)
    except Exception:
        pass

    # Short-term from Redis (db1, key pattern "mem:*")
    short_users = 0
    short_entries = 0
    try:
        import redis.asyncio as aioredis
        from interface.dependencies import _get_config
        cfg = _get_config()
        redis_url = cfg.get("redis_url", "redis://redis:6379/0")
        # Short-term memory uses db1 — replace trailing /0 with /1
        redis_url_db1 = redis_url[:-1] + "1" if redis_url.endswith("/0") else redis_url.rstrip("/") + "/1"
        r = aioredis.from_url(redis_url_db1, decode_responses=True)
        import json as _json
        keys = await r.keys("mem:*")
        short_users = len(keys)
        for key in keys:
            raw = await r.get(key)
            if raw:
                try:
                    short_entries += len(_json.loads(raw))
                except Exception:
                    short_entries += 1
        await r.aclose()
    except Exception:
        pass

    return {
        "short_term_users": short_users,
        "short_term_entries": short_entries,
        "long_term_users": long_users,
        "long_term_entries": long_entries,
    }


@router.get("/memory/users/list")
async def memory_users(doc_repo=Depends(get_doc_repo)):
    """List all profiles known to memory, including empty profiles."""
    try:
        pool = await doc_repo._get_pool()
        rows = await pool.fetch(
            """
            WITH entry_stats AS (
                SELECT user_id,
                       COUNT(*) AS entry_count,
                       MAX(created_at) AS last_updated
                FROM user_memory
                GROUP BY user_id
            )
            SELECT
                COALESCE(e.user_id, p.user_id) AS user_id,
                COALESCE(e.entry_count, 0) AS entry_count,
                e.last_updated,
                p.label,
                p.notes,
                p.created_at AS profile_created_at,
                p.created_by
            FROM memory_profiles p
            FULL OUTER JOIN entry_stats e
              ON e.user_id = p.user_id
            ORDER BY COALESCE(e.last_updated, p.created_at) DESC NULLS LAST,
                     COALESCE(e.user_id, p.user_id)
            """
        )
        return [
            {
                "user_id": r["user_id"],
                "entry_count": int(r["entry_count"]),
                "last_updated": r["last_updated"].isoformat() if r["last_updated"] else None,
                "label": r["label"],
                "notes": r["notes"],
                "created_at": r["profile_created_at"].isoformat() if r["profile_created_at"] else None,
                "created_by": r["created_by"],
            }
            for r in rows
        ]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/memory/{user_id}")
async def memory_list(user_id: str, backend: str = "all",
                      memory=Depends(get_memory_service)):
    if not memory:
        raise HTTPException(status_code=503, detail="Memory service not enabled")
    from infrastructure.adapters.memory_service import CompositeMemoryAdapter
    if isinstance(memory, CompositeMemoryAdapter):
        if backend == "short":
            entries = await memory.list_short(user_id)
        elif backend == "long":
            entries = await memory.list_long(user_id)
        else:
            entries = await memory.list(user_id)
    else:
        entries = await memory.list(user_id)
    return {"entries": entries}


@router.delete("/memory/{user_id}/{memory_id}")
async def memory_delete(user_id: str, memory_id: str,
                        memory=Depends(get_memory_service)):
    if not memory:
        raise HTTPException(status_code=503, detail="Memory service not enabled")
    await memory.delete(user_id, memory_id)
    return {"status": "deleted"}


# ---------------------------------------------------------------------------
# Semantic Cache
# ---------------------------------------------------------------------------

@router.get("/cache/entries")
async def cache_entries(namespace: str | None = None, doc_repo=Depends(get_doc_repo)):
    """List semantic cache entries with original query text from interaction_log."""
    import json as _json
    import redis.asyncio as aioredis
    from interface.dependencies import _get_config
    cfg = _get_config()
    redis = aioredis.from_url(cfg["redis_url"], decode_responses=True)
    try:
        keys = await redis.keys("cache:*")
        entries = []
        for key in keys:
            raw = await redis.get(key)
            ttl = await redis.ttl(key)
            if not raw:
                continue
            try:
                data = _json.loads(raw)
                result = data.get("result", {})
                request_id = result.get("request_id")
                # Look up original query from interaction_log
                query_text = None
                try:
                    pool = await doc_repo._get_pool()
                    row = await pool.fetchrow(
                        "SELECT query_text FROM interaction_log WHERE request_id = $1 LIMIT 1",
                        request_id,
                    )
                    if row:
                        query_text = row["query_text"]
                except Exception:
                    pass
                entries.append({
                    "key": key,
                    "request_id": request_id,
                    "namespace": data.get("namespace", "default"),
                    "query_text": query_text,
                    "answer_snippet": (result.get("answer") or "")[:150],
                    "citations_count": len(result.get("citations") or []),
                    "ttl_seconds": ttl,
                })
            except Exception:
                continue
        if namespace:
            entries = [e for e in entries if e.get("namespace") == namespace]
        entries.sort(key=lambda e: e["ttl_seconds"], reverse=True)
        return entries
    finally:
        await redis.aclose()


@router.delete("/cache")
async def cache_clear_all(request: Request):
    """Delete all semantic cache entries from Redis."""
    import redis.asyncio as aioredis
    from interface.dependencies import _get_config
    cfg = _get_config()
    redis = aioredis.from_url(cfg["redis_url"], decode_responses=True)
    try:
        keys = await redis.keys("cache:*")
        if keys:
            await redis.delete(*keys)
        from infrastructure.adapters.token_quota import record_admin_action
        await record_admin_action(
            admin_user_id=request.headers.get("x-admin-user"),
            action="clear_cache",
            resource_type="cache",
            target_id="all",
            before_value={"entry_count": len(keys)},
            after_value={"entry_count": 0},
        )
        return {"deleted": len(keys)}
    finally:
        await redis.aclose()


@router.delete("/cache/{cache_key}")
async def cache_delete_one(cache_key: str, request: Request):
    """Delete a single semantic cache entry."""
    import redis.asyncio as aioredis
    from interface.dependencies import _get_config
    cfg = _get_config()
    redis = aioredis.from_url(cfg["redis_url"], decode_responses=True)
    try:
        raw = await redis.get(f"cache:{cache_key}")
        deleted = await redis.delete(f"cache:{cache_key}")
        from infrastructure.adapters.token_quota import record_admin_action
        await record_admin_action(
            admin_user_id=request.headers.get("x-admin-user"),
            action="delete_cache_entry",
            resource_type="cache_entry",
            target_id=cache_key,
            before_value={"present": raw is not None},
            after_value={"present": False},
        )
        return {"deleted": deleted}
    finally:
        await redis.aclose()


# ---------------------------------------------------------------------------
# Knowledge Gaps
# ---------------------------------------------------------------------------

@router.get("/knowledge-gaps", response_model=list)
async def list_knowledge_gaps(
    namespace: Optional[str] = None,
    status: str = "open",
    limit: int = 200,
    doc_repo=Depends(get_doc_repo),
):
    """List knowledge gap entries. status: open | promoted | ignored | all. namespace: omit for all namespaces."""
    try:
        pool = await doc_repo._get_pool()
        all_statuses = status == "all"
        all_ns = not namespace or namespace == "*"

        if all_statuses and all_ns:
            rows = await pool.fetch(
                """SELECT id, query_text, namespace, top_score, threshold,
                          occurrence_count, logged_at, last_seen, status
                   FROM knowledge_gap_log
                   ORDER BY occurrence_count DESC, last_seen DESC
                   LIMIT $1""",
                limit,
            )
        elif all_statuses:
            rows = await pool.fetch(
                """SELECT id, query_text, namespace, top_score, threshold,
                          occurrence_count, logged_at, last_seen, status
                   FROM knowledge_gap_log
                   WHERE namespace = $1
                   ORDER BY occurrence_count DESC, last_seen DESC
                   LIMIT $2""",
                namespace, limit,
            )
        elif all_ns:
            rows = await pool.fetch(
                """SELECT id, query_text, namespace, top_score, threshold,
                          occurrence_count, logged_at, last_seen, status
                   FROM knowledge_gap_log
                   WHERE status = $1
                   ORDER BY occurrence_count DESC, last_seen DESC
                   LIMIT $2""",
                status, limit,
            )
        else:
            rows = await pool.fetch(
                """SELECT id, query_text, namespace, top_score, threshold,
                          occurrence_count, logged_at, last_seen, status
                   FROM knowledge_gap_log
                   WHERE namespace = $1 AND status = $2
                   ORDER BY occurrence_count DESC, last_seen DESC
                   LIMIT $3""",
                namespace, status, limit,
            )
        return [
            KnowledgeGapResponse(
                id=str(r["id"]),
                query_text=r["query_text"],
                namespace=r["namespace"],
                top_score=r["top_score"],
                threshold=r["threshold"],
                occurrence_count=r["occurrence_count"],
                logged_at=r["logged_at"].isoformat(),
                last_seen=r["last_seen"].isoformat(),
                status=r["status"],
            ).model_dump()
            for r in rows
        ]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/knowledge-gaps/{gap_id}/promote")
async def promote_knowledge_gap(
    gap_id: str,
    request: Request,
    doc_repo=Depends(get_doc_repo),
):
    """Promote a knowledge gap to the approval queue as a candidate."""
    import uuid as _uuid
    from datetime import datetime, timezone, timedelta
    try:
        pool = await doc_repo._get_pool()
        row = await pool.fetchrow(
            "SELECT * FROM knowledge_gap_log WHERE id = $1", gap_id,
        )
        if not row:
            raise HTTPException(status_code=404, detail="Knowledge gap not found")
        if row["status"] != "open":
            raise HTTPException(status_code=409,
                                detail=f"Gap already {row['status']}")

        candidate_id = str(_uuid.uuid4())
        content = f"Q: {row['query_text']}\n\n[Promoted from knowledge gap — awaiting enrichment]"
        expires_at = datetime.now(timezone.utc) + timedelta(days=30)
        await pool.execute(
            """INSERT INTO approval_queue
               (id, proposed_content, supporting_interaction_ids, confidence_score,
                status, expires_at)
               VALUES ($1, $2, $3, $4, 'pending', $5)""",
            candidate_id, content, [], row["top_score"], expires_at,
        )
        await pool.execute(
            "UPDATE knowledge_gap_log SET status = 'promoted' WHERE id = $1", gap_id,
        )
        from infrastructure.adapters.token_quota import record_admin_action
        await record_admin_action(
            admin_user_id=request.headers.get("x-admin-user"),
            action="promote_knowledge_gap",
            resource_type="knowledge_gap",
            target_id=gap_id,
            before_value={"status": "open", "query_text": row["query_text"]},
            after_value={"status": "promoted", "candidate_id": candidate_id},
        )
        return {"status": "promoted", "candidate_id": candidate_id, "gap_id": gap_id}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/documents/{document_id}/versions")
async def document_versions(document_id: str, doc_repo=Depends(get_doc_repo)):
    """List version history for a document (from document_versions table)."""
    try:
        pool = await doc_repo._get_pool()
        rows = await pool.fetch(
            """SELECT id, document_id, version, ingested_at, chunk_count, is_active
               FROM document_versions
               WHERE document_id = $1
               ORDER BY version DESC""",
            document_id,
        )
        return [
            {
                "id": str(r["id"]),
                "document_id": str(r["document_id"]),
                "version": r["version"],
                "ingested_at": r["ingested_at"].isoformat() if r["ingested_at"] else None,
                "chunk_count": r["chunk_count"],
                "is_active": r["is_active"],
            }
            for r in rows
        ]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/quota/{client_id}")
async def quota_stats(client_id: str, use_case=Depends(get_query_use_case)):
    """Return token quota usage for a client."""
    redis = getattr(use_case, "_redis", None)
    if not redis:
        return {"client_id": client_id, "tokens_used_today": 0, "daily_limit": 0, "remaining": None}
    from infrastructure.adapters.token_quota import get_quota_stats
    return await get_quota_stats(redis, client_id)


@router.patch("/quota/{client_id}")
async def update_quota_stats(
    client_id: str,
    req: QuotaUpdateRequest,
    request: Request,
    use_case=Depends(get_query_use_case),
):
    """Set or update a runtime token quota override for a client."""
    redis = getattr(use_case, "_redis", None)
    if not redis:
        raise HTTPException(status_code=503, detail="Quota config unavailable")
    from infrastructure.adapters.token_quota import set_quota_override
    try:
        return await set_quota_override(
            redis,
            client_id,
            req.daily_limit,
            admin_user_id=request.headers.get("x-admin-user"),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.delete("/quota/{client_id}")
async def delete_quota_override(
    client_id: str,
    request: Request,
    use_case=Depends(get_query_use_case),
):
    """Clear a runtime token quota override for a client."""
    redis = getattr(use_case, "_redis", None)
    if not redis:
        raise HTTPException(status_code=503, detail="Quota config unavailable")
    from infrastructure.adapters.token_quota import clear_quota_override
    return await clear_quota_override(
        redis,
        client_id,
        admin_user_id=request.headers.get("x-admin-user"),
    )


@router.get("/rate-limit/{client_id}")
async def rate_limit_config(client_id: str, use_case=Depends(get_query_use_case)):
    redis = getattr(use_case, "_redis", None)
    if not redis:
        return {
            "client_id": client_id,
            "requests_this_minute": 0,
            "rpm_limit": 60,
            "remaining_this_minute": None,
            "has_override": False,
            "override_source": None,
        }
    from infrastructure.adapters.token_quota import get_rate_limit_config_stats
    return await get_rate_limit_config_stats(redis, client_id)


@router.patch("/rate-limit/{client_id}")
async def update_rate_limit_config(
    client_id: str,
    req: RateLimitUpdateRequest,
    request: Request,
    use_case=Depends(get_query_use_case),
):
    redis = getattr(use_case, "_redis", None)
    if not redis:
        raise HTTPException(status_code=503, detail="Rate limit config unavailable")
    from infrastructure.adapters.token_quota import set_rate_limit_override
    try:
        return await set_rate_limit_override(
            redis,
            client_id,
            req.rpm_limit,
            admin_user_id=request.headers.get("x-admin-user"),
            notes=req.notes,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.delete("/rate-limit/{client_id}")
async def delete_rate_limit_override(
    client_id: str,
    request: Request,
    use_case=Depends(get_query_use_case),
):
    redis = getattr(use_case, "_redis", None)
    if not redis:
        raise HTTPException(status_code=503, detail="Rate limit config unavailable")
    from infrastructure.adapters.token_quota import clear_rate_limit_override
    return await clear_rate_limit_override(
        redis,
        client_id,
        admin_user_id=request.headers.get("x-admin-user"),
    )


@router.get("/rate-limit/stats")
async def rate_limit_stats_endpoint(use_case=Depends(get_query_use_case)):
    """Return active rate-limit counters for current minute."""
    redis = getattr(use_case, "_redis", None)
    if not redis:
        return {"active_clients": 0, "default_rpm": 60, "top_clients": []}
    import os
    from datetime import datetime
    from infrastructure.adapters.token_quota import _get_rate_limit_limit
    default_rpm = int(os.getenv("RATE_LIMIT_DEFAULT_RPM", "60"))
    window_minute = int(datetime.utcnow().timestamp() / 60)
    try:
        keys = await redis.keys(f"rate_limit:*:{window_minute}")
        top_clients = []
        for key in keys[:20]:
            count = await redis.get(key)
            parts = key.split(":")
            cid = parts[2] if len(parts) >= 3 else key
            limit, has_override, override_source = await _get_rate_limit_limit(redis, cid)
            top_clients.append({
                "client_id": cid,
                "requests_this_minute": int(count or 0),
                "rpm_limit": limit,
                "has_override": has_override,
                "override_source": override_source,
            })
        top_clients.sort(key=lambda x: x["requests_this_minute"], reverse=True)
        return {"active_clients": len(keys), "default_rpm": default_rpm, "top_clients": top_clients}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/admin/action-log")
async def admin_action_log(
    limit: int = 100,
    resource_type: Optional[str] = None,
):
    from infrastructure.adapters.token_quota import list_admin_actions
    return await list_admin_actions(limit=limit, resource_type=resource_type)


@router.post("/knowledge-gaps/{gap_id}/ignore")
async def ignore_knowledge_gap(gap_id: str, request: Request, doc_repo=Depends(get_doc_repo)):
    """Mark a knowledge gap as ignored (won't appear in open list)."""
    try:
        pool = await doc_repo._get_pool()
        row = await pool.fetchrow(
            "SELECT query_text, status FROM knowledge_gap_log WHERE id = $1",
            gap_id,
        )
        result = await pool.execute(
            "UPDATE knowledge_gap_log SET status = 'ignored' WHERE id = $1 AND status = 'open'",
            gap_id,
        )
        if result == "UPDATE 0":
            raise HTTPException(status_code=404, detail="Gap not found or already actioned")
        from infrastructure.adapters.token_quota import record_admin_action
        await record_admin_action(
            admin_user_id=request.headers.get("x-admin-user"),
            action="ignore_knowledge_gap",
            resource_type="knowledge_gap",
            target_id=gap_id,
            before_value={"status": row["status"] if row else "open", "query_text": row["query_text"] if row else None},
            after_value={"status": "ignored"},
        )
        return {"status": "ignored", "gap_id": gap_id}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
