"""
QueryUseCase — orchestrates the full RAG query pipeline:
Cache → Memory → Query Intelligence → Parallel Retrieval (Vector + Graph)
→ RRF Merge → Reranker → Context Builder → Compressor → LLM → Answer + Citations
"""
import asyncio
import json
import logging
import os
import re
import time
import uuid
from dataclasses import dataclass, field
from typing import Optional, List, AsyncIterator

from application.ports.i_embedding_service import IEmbeddingService
from application.ports.i_vector_store import IVectorStore
from application.ports.i_llm_service import ILLMService
from application.ports.i_document_repository import IDocumentRepository
from application.ports.i_graph_service import IGraphService
from application.ports.i_reranker import IReranker
from application.ports.i_context_builder import IContextBuilder
from application.ports.i_context_compressor import IContextCompressor
from application.ports.i_query_rewriter import IQueryRewriter
from application.ports.i_hyde_generator import IHyDEGenerator
from application.ports.i_query_decomposer import IQueryDecomposer
from application.ports.i_semantic_cache import ISemanticCache
from application.ports.i_memory_service import IMemoryService
from application.ports.i_logger import ILogger
from application.ports.i_tool_router import IToolRouter
from domain.entities import (
    QueryResult, Citation, RerankedResult, QueryIntelligenceResult,
)
from domain.errors import EmptyQueryError, QueryTimeoutError, QuotaExceededError
from application.context_builder import ContextBuilder
from application.context_compressor import NoOpCompressor
from application.citation_verifier import CitationVerifier, CitationVerificationResult
from application.freshness_scorer import apply_freshness
from application.routing_policy import RoutingPolicy
from infrastructure.adapters.reranker_client import rrf_merge
from infrastructure.circuit_breaker import get_breaker, CircuitOpenError

logger = logging.getLogger(__name__)

_QUERY_TIMEOUT = float(os.getenv("QUERY_TIMEOUT", "300"))  # seconds (300s for CPU Ollama)

_ANSWER_SYSTEM_PROMPT = (
    "/no_think You are a precise answer generator for an upstream agent. "
    "Use ONLY the provided context. Answer the user's question directly and clearly. "
    "Lead with the conclusion or exact answer first, then add only the facts needed to support it. "
    "Do not restate the question, add filler, or wander into background unless it is required to answer correctly. "
    "If the context contains multiple relevant facts, organize them with short bullets or a compact list. "
    "If the context is ambiguous, say what is missing or ambiguous instead of guessing. "
    "Always output in this exact structure:\n"
    "Answer: <one direct answer>\n"
    "Facts:\n"
    "- <fact 1>\n"
    "- <fact 2>\n"
    "Evidence:\n"
    "- <document_id> / <chunk_id>\n"
    "Missing:\n"
    "- <what is missing or 'none'>\n"
    "Next:\n"
    "- <recommended next action or 'use_as_final'>\n"
    "Keep each line short. Do not add extra sections.\n"
    "If the context does not contain enough information, reply exactly: "
    "'I don't have enough information to answer this question.'"
)

_ANSWER_PROMPT = (
    "Context:\n{context}\n\n"
    "Question: {query}\n\n"
    "Answer the question using only the context. Fill the structure exactly."
)


def _sse_event(event_type: str, data: dict) -> str:
    """Format a Server-Sent Events data line."""
    data["type"] = event_type
    return f"data: {json.dumps(data)}\n\n"


def _graph_entity_payload(entity: object) -> dict:
    """Normalize graph service output into the dashboard-friendly shape."""
    if isinstance(entity, dict):
        return {
            "name": entity.get("name", ""),
            "type": entity.get("type", entity.get("label", "")),
        }
    return {"name": str(entity), "type": ""}


@dataclass
class QueryRequest:
    query: str
    namespace: str = "default"
    namespaces: Optional[List[str]] = None  # multi-namespace; overrides namespace when set
    client_id: Optional[str] = None
    user_id: Optional[str] = None
    top_k: int = 10
    top_n_rerank: int = 5
    max_context_tokens: int = 4096
    use_cache: bool = True
    force_refresh: bool = False
    use_memory: bool = False
    use_hyde: bool = False
    use_rewrite: bool = False
    use_decompose: bool = False
    use_graph: bool = True
    use_tools: bool = False

    @property
    def effective_namespaces(self) -> List[str]:
        """Return list of namespaces to query. Multi-namespace overrides single."""
        if self.namespaces:
            return self.namespaces
        return [self.namespace]

    @property
    def cache_namespace_key(self) -> str:
        """Stable cache key for namespace(s)."""
        return "|".join(sorted(self.effective_namespaces))


class QueryUseCase:
    @staticmethod
    def _resolve_client_id(request: QueryRequest) -> str:
        return request.client_id or request.user_id or "anonymous"

    @staticmethod
    def _extract_graph_seed_names(query: str) -> List[str]:
        cleaned = query.strip()
        if not cleaned:
            return []

        seeds: List[str] = []

        team_match = re.search(
            r"(?:\bทีม\b|\bteam\b)\s+([A-Za-z0-9ก-๙_.\-/ ]{2,80})",
            cleaned,
            flags=re.IGNORECASE,
        )
        if team_match:
            team_tail = team_match.group(1).strip()
            team_name = re.sub(
                r"\s+(?:มี|ได้แก่|คือ|เป็น|รับผิดชอบ|ดูแล|ทำหน้าที่|ของ|ที่|ซึ่ง|และ|โดย)\b.*$",
                "",
                team_tail,
                flags=re.IGNORECASE,
            ).strip(" ,.;:，。")
            if team_name:
                seeds.append(team_name)

        for token in re.findall(r"\b[A-Z]{2,}\b", cleaned):
            if token not in seeds:
                seeds.append(token)

        return list(dict.fromkeys(seeds))

    async def _retrieve_one_namespace(
        self,
        retrieval_embedding: list,
        retrieval_query: str,
        namespace: str,
        top_k: int,
        use_graph: bool,
    ):
        """Vector + graph retrieval for a single namespace."""
        vector_task = self._vector_store.search(
            retrieval_embedding, top_k=top_k, namespace=namespace
        )
        graph_entity_names = self._extract_graph_seed_names(retrieval_query)
        graph_task = (
            self._graph.query_related_entities(
                retrieval_query,
                top_k=top_k,
                namespace=namespace,
                entity_names=graph_entity_names,
            )
            if self._graph and use_graph
            else asyncio.coroutine(lambda: [])()
        )
        vecs, ents = await asyncio.gather(vector_task, graph_task, return_exceptions=True)
        if isinstance(vecs, Exception):
            logger.error("Vector search failed for namespace=%s: %s", namespace, vecs)
            vecs = []
        if isinstance(ents, Exception):
            logger.warning("Graph query failed for namespace=%s: %s", namespace, ents)
            ents = []
        return vecs or [], ents or []

    def __init__(
        self,
        embedding_service: IEmbeddingService,
        vector_store: IVectorStore,
        llm_service: ILLMService,
        document_repository: IDocumentRepository,
        reranker: IReranker,
        context_builder: IContextBuilder,
        context_compressor: IContextCompressor,
        semantic_cache: Optional[ISemanticCache] = None,
        memory_service: Optional[IMemoryService] = None,
        graph_service: Optional[IGraphService] = None,
        query_rewriter: Optional[IQueryRewriter] = None,
        hyde_generator: Optional[IHyDEGenerator] = None,
        query_decomposer: Optional[IQueryDecomposer] = None,
        app_logger: Optional[ILogger] = None,
        tool_router: Optional[IToolRouter] = None,
        citation_verifier: Optional[CitationVerifier] = None,
        redis_client=None,
        routing_policy: Optional[RoutingPolicy] = None,
    ):
        self._embed = embedding_service
        self._vector_store = vector_store
        self._llm = llm_service
        self._doc_repo = document_repository
        self._reranker = reranker
        self._ctx_builder = context_builder
        self._compressor = context_compressor
        self._cache = semantic_cache
        self._memory = memory_service
        self._graph = graph_service
        self._rewriter = query_rewriter
        self._hyde = hyde_generator
        self._decomposer = query_decomposer
        self._log = app_logger
        self._tool_router = tool_router
        self._policy = routing_policy or RoutingPolicy.from_env()
        self._citation_verifier = citation_verifier or CitationVerifier(
            grounding_threshold=self._policy.grounding_threshold,
            overlap_threshold=self._policy.citation_overlap_threshold,
        )
        self._redis = redis_client
        self._intelligence_url = os.getenv("INTELLIGENCE_SERVICE_URL", "http://intelligence-service:8003")
        self._intelligence_breaker = get_breaker("intelligence", redis_client=redis_client)

    async def execute(self, request: QueryRequest) -> QueryResult:
        query = request.query.strip()
        if not query:
            raise EmptyQueryError("Query must not be empty")

        request_id = str(uuid.uuid4())
        t_start = time.monotonic()

        try:
            result = await asyncio.wait_for(
                self._run_pipeline(request_id, query, request),
                timeout=_QUERY_TIMEOUT,
            )
        except asyncio.TimeoutError:
            raise QueryTimeoutError(f"Query timed out after {_QUERY_TIMEOUT}s")

        result.total_latency_ms = (time.monotonic() - t_start) * 1000
        # Log every interaction (including cache hits) for accurate metrics
        asyncio.create_task(self._log_interaction(result, query))
        return result

    async def execute_stream(self, request: QueryRequest) -> AsyncIterator[str]:
        """Execute the RAG pipeline and yield SSE events (token / citations / done)."""
        query = request.query.strip()
        if not query:
            raise EmptyQueryError("Query must not be empty")

        request_id = str(uuid.uuid4())
        t_start = time.monotonic()

        # ── Phase 1: Retrieval + context (same as _run_pipeline steps 1-11) ──

        # Rate limit check (fail-fast before any work)
        client_id = self._resolve_client_id(request)
        if self._redis and client_id != "anonymous":
            from infrastructure.adapters.token_quota import check_rate_limit
            if not await check_rate_limit(self._redis, client_id):
                import json as _json
                yield _sse_event("error", {"message": "Rate limit exceeded. Try again in a minute."})
                return

        t_retrieval = time.monotonic()
        query_embedding = await self._embed.embed(query)

        # Semantic cache check
        if self._cache and request.use_cache and not request.force_refresh:
            cached = await self._cache.get(query_embedding, namespace=request.cache_namespace_key)
            if cached:
                # Stream cached answer word-by-word
                words = cached.answer.split()
                for i, word in enumerate(words):
                    sep = " " if i < len(words) - 1 else ""
                    yield _sse_event("token", {"content": word + sep})
                yield _sse_event("citations", {
                    "citations": [
                        {"chunk_id": c.chunk_id, "document_id": c.document_id,
                         "filename": c.filename, "text_snippet": c.text_snippet,
                         "score": c.score, "sequence_index": c.sequence_index}
                        for c in cached.citations
                    ],
                    "grounding_score": cached.grounding_score,
                    "low_confidence": cached.low_confidence,
                })
                yield _sse_event("done", {
                    "request_id": request_id,
                    "from_cache": True,
                    "total_latency_ms": (time.monotonic() - t_start) * 1000,
                })
                return

        # Memory retrieval
        memory_context = ""
        if self._memory and request.use_memory and request.user_id:
            entries = await self._memory.get(request.user_id, query)
            if entries:
                memory_context = "\n".join(e["content"] for e in entries[:5])

        # Query Intelligence
        intel = await self._apply_intelligence(query, request)
        retrieval_query = intel.rewritten_query
        embed_query = intel.hyde_document or retrieval_query

        # Parallel retrieval (all namespaces in parallel)
        retrieval_embedding = await self._embed.embed(embed_query)
        ns_tasks = [
            self._retrieve_one_namespace(
                retrieval_embedding, retrieval_query, ns,
                request.top_k, request.use_graph
            )
            for ns in request.effective_namespaces
        ]
        ns_results = await asyncio.gather(*ns_tasks, return_exceptions=True)

        all_vector_lists: List[List[RerankedResult]] = []
        all_graph_entities_raw: list = []
        for ns, res in zip(request.effective_namespaces, ns_results):
            if isinstance(res, Exception):
                logger.error("Retrieval failed for namespace=%s: %s", ns, res)
                continue
            vecs, ents = res
            if vecs:
                all_vector_lists.append(vecs)
            all_graph_entities_raw.extend(ents)

        if len(all_vector_lists) > 1:
            vector_results = rrf_merge(all_vector_lists, top_n=request.top_k)
        elif all_vector_lists:
            vector_results = all_vector_lists[0][:request.top_k]
        else:
            vector_results = []

        # Graph results → RerankedResult (deduplicated)
        graph_results: List[RerankedResult] = []
        graph_entities: List[dict] = []
        graph_entity_texts: List[str] = []
        seen_graph: set = set()
        for i, entity in enumerate(all_graph_entities_raw):
            payload = _graph_entity_payload(entity)
            text = payload["name"]
            if text in seen_graph:
                continue
            seen_graph.add(text)
            graph_entities.append(payload)
            graph_entity_texts.append(text)
            graph_results.append(RerankedResult(
                chunk_id=f"graph_{i}", document_id="graph", text=text,
                score=1.0 / (i + 1), original_rank=i, reranked_rank=i,
            ))

        # RRF merge (vector + graph)
        all_lists = [r for r in [vector_results, graph_results] if r]
        merged = rrf_merge(all_lists, top_n=request.top_k) if len(all_lists) > 1 else (
            vector_results[:request.top_k] if vector_results else []
        )

        # Apply freshness scoring + expiry filtering
        merged = apply_freshness(merged)

        retrieval_latency_ms = (time.monotonic() - t_retrieval) * 1000

        # Rerank
        reranked = await self._reranker.rerank(
            retrieval_query, merged, top_n=request.top_n_rerank
        )

        # Store chunk_ids in Redis for feedback tracking (non-blocking)
        if self._redis and reranked:
            asyncio.create_task(self._store_req_chunks(request_id, reranked))

        # Apply feedback boost from historical ratings
        if self._redis and reranked:
            reranked = await self._apply_feedback_boost(reranked)

        # Knowledge gap detection — log when KB score is low (no auto-fetch)
        top_score = reranked[0].score if reranked else 0.0
        if not reranked or top_score < self._policy.knowledge_gap_threshold:
            asyncio.create_task(
                self._log_knowledge_gap(query, request.cache_namespace_key, top_score)
            )

        # Context building
        context = await self._ctx_builder.build(
            retrieval_query, reranked, max_tokens=request.max_context_tokens,
        )
        if context.was_truncated:
            compressed = await self._compressor.compress(
                retrieval_query, context, max_tokens=request.max_context_tokens
            )
            context_text = compressed.text
        else:
            context_text = "\n\n".join(c.text for c in context.chunks)

        if memory_context:
            context_text = f"[User Memory]\n{memory_context}\n\n[Knowledge]\n{context_text}"

        if graph_entity_texts:
            context_text += f"\n\n[Related Entities]\n{', '.join(graph_entity_texts)}"

        # Tool routing
        stream_tool_calls: list = []
        if self._tool_router and request.use_tools:
            try:
                stream_tool_calls = await self._tool_router.route(query, "")
                if stream_tool_calls:
                    tool_results = "\n".join(
                        f"[{tc.tool_name}] {tc.output}" for tc in stream_tool_calls
                    )
                    context_text = f"[Tool Results]\n{tool_results}\n\n{context_text}"
            except Exception as exc:
                logger.warning("Tool router failed: %s", exc)

        # ── Phase 2: Streaming LLM generation ──
        t_gen = time.monotonic()
        answer_parts: List[str] = []

        kb_relevant_stream = top_score >= self._policy.knowledge_gap_threshold
        _DIRECT_TOOLS = {"direct_answer", "datetime", "calculator", "code_executor"}
        stream_direct_only = (
            stream_tool_calls
            and len(stream_tool_calls) == 1
            and stream_tool_calls[0].tool_name in _DIRECT_TOOLS
            and not kb_relevant_stream
        )
        if stream_direct_only:
            no_info = str(stream_tool_calls[0].output)
            yield _sse_event("token", {"content": no_info})
            answer_parts.append(no_info)
        elif not context.chunks and not stream_tool_calls:
            no_info = "I don't have enough information to answer this question."
            yield _sse_event("token", {"content": no_info})
            answer_parts.append(no_info)
        else:
            if stream_tool_calls and not kb_relevant_stream:
                gen_ctx = "\n".join(f"[{tc.tool_name}] {tc.output}" for tc in stream_tool_calls)
            else:
                gen_ctx = context_text
            prompt = _ANSWER_PROMPT.format(context=gen_ctx, query=query)
            try:
                async for token in self._llm.generate_stream(
                    prompt,
                    system_prompt=_ANSWER_SYSTEM_PROMPT,
                ):
                    yield _sse_event("token", {"content": token})
                    answer_parts.append(token)
            except asyncio.CancelledError:
                return  # Client disconnected

        answer = "".join(answer_parts)
        generation_latency_ms = (time.monotonic() - t_gen) * 1000

        # Citation verification
        verification: Optional[CitationVerificationResult] = None
        if context.chunks and self._citation_verifier:
            verification = self._citation_verifier.verify(answer, reranked, query)
            if verification.low_confidence:
                warning = (
                    f"\n\n[Note: This answer has low grounding confidence "
                    f"({verification.grounding_score:.0%}) and may contain unsupported claims.]"
                )
                yield _sse_event("token", {"content": warning})
                answer += warning
                asyncio.create_task(
                    self._enqueue_low_confidence(request_id, query, answer,
                                                 verification.grounding_score)
                )

        grounding_score = verification.grounding_score if verification else 1.0
        low_confidence = verification.low_confidence if verification else False

        # Build citations (vector chunks only)
        citations = [
            Citation(
                chunk_id=c.chunk_id,
                document_id=c.document_id,
                filename=c.metadata.get("filename", c.document_id),
                text_snippet=c.text[:200],
                score=c.score,
                sequence_index=c.metadata.get("sequence_index", 0),
            )
            for c in context.chunks
            if c.document_id != "graph"
        ]

        yield _sse_event("citations", {
            "citations": [
                {"chunk_id": c.chunk_id, "document_id": c.document_id,
                 "filename": c.filename, "text_snippet": c.text_snippet,
                 "score": c.score, "sequence_index": c.sequence_index}
                for c in citations
            ],
            "grounding_score": grounding_score,
            "low_confidence": low_confidence,
        })

        total_latency_ms = (time.monotonic() - t_start) * 1000
        yield _sse_event("done", {
            "request_id": request_id,
            "from_cache": False,
            "rewritten_query": intel.rewritten_query if intel.rewritten_query != query else None,
            "hyde_used": intel.hyde_used,
            "sub_queries": intel.sub_queries,
            "retrieval_latency_ms": retrieval_latency_ms,
            "generation_latency_ms": generation_latency_ms,
            "total_latency_ms": total_latency_ms,
            "grounding_score": grounding_score,
            "low_confidence": low_confidence,
        })

        # Cache + log in background
        result = QueryResult(
            request_id=request_id,
            answer=answer,
            citations=citations,
            graph_entities=graph_entities,
            rewritten_query=intel.rewritten_query if intel.rewritten_query != query else None,
            hyde_used=intel.hyde_used,
            sub_queries=intel.sub_queries,
            from_cache=False,
            retrieval_latency_ms=retrieval_latency_ms,
            generation_latency_ms=generation_latency_ms,
            grounding_score=grounding_score,
            low_confidence=low_confidence,
        )
        if self._cache and request.use_cache and citations:
            asyncio.create_task(self._cache.set(query_embedding, result, namespace=request.cache_namespace_key))
        asyncio.create_task(self._log_interaction(result, query))
        if self._memory and request.user_id:
            asyncio.create_task(self._save_interaction_memory(
                request.user_id, query, answer, long_term=request.use_memory
            ))
        if citations:
            contexts = [c.text_snippet for c in citations]
            asyncio.create_task(self._run_ragas_evaluation(request_id, query, answer, contexts))

    async def _run_pipeline(self, request_id: str, query: str,
                             req: QueryRequest) -> QueryResult:
        stages: list = []

        def _s(name: str, fired: bool, ms: float, **meta) -> None:
            stages.append({"stage": name, "fired": fired,
                           "latency_ms": round(ms, 2), "meta": meta})

        # 0. Rate limit check (fail-fast before any work)
        client_id = self._resolve_client_id(req)
        if self._redis and client_id != "anonymous":
            from infrastructure.adapters.token_quota import check_rate_limit
            if not await check_rate_limit(self._redis, client_id):
                raise QuotaExceededError(client_id=client_id, reset_at="next minute")

        # 1. Embed query
        t_retrieval = time.monotonic()
        t = time.monotonic()
        query_embedding = await self._embed.embed(query)
        _s("embed", True, (time.monotonic() - t) * 1000)

        # 2. Semantic cache check
        if self._cache and req.use_cache and not req.force_refresh:
            t = time.monotonic()
            cached = await self._cache.get(query_embedding, namespace=req.cache_namespace_key)
            cache_ms = (time.monotonic() - t) * 1000
            if cached:
                _s("cache", True, cache_ms, hit=True)
                cached.request_id = request_id
                cached.from_cache = True
                cached.stages = stages
                return cached
            _s("cache", True, cache_ms, hit=False)

        # 3. Memory retrieval
        memory_context = ""
        memory_context_chars = 0
        if self._memory and req.use_memory and req.user_id:
            t = time.monotonic()
            entries = await self._memory.get(req.user_id, query)
            mem_ms = (time.monotonic() - t) * 1000
            if entries:
                memory_context = "\n".join(e["content"] for e in entries[:5])
                memory_context_chars = len(memory_context)
                short_cnt = sum(1 for e in entries[:5]
                                if (e.get("metadata") or {}).get("_save_target") != "composite")
                long_cnt  = sum(1 for e in entries[:5]
                                if (e.get("metadata") or {}).get("_save_target") == "composite")
                if short_cnt:
                    _s("short_memory", True, mem_ms, entry_count=short_cnt, user_id=req.user_id)
                if long_cnt:
                    _s("long_memory", True, 0.0, entry_count=long_cnt, user_id=req.user_id)
            else:
                _s("short_memory", False, mem_ms, user_id=req.user_id)

        # 4. Query Intelligence
        t = time.monotonic()
        intel = await self._apply_intelligence(query, req)
        qintel_ms = (time.monotonic() - t) * 1000
        q_intel_fired = (intel.rewritten_query != query) or intel.hyde_used or bool(intel.sub_queries)
        if req.use_rewrite or req.use_hyde or req.use_decompose:
            _s("q_intel", q_intel_fired, qintel_ms,
               rewritten=intel.rewritten_query != query,
               hyde=intel.hyde_used,
               sub_queries=len(intel.sub_queries))

        retrieval_query = intel.rewritten_query
        embed_query = intel.hyde_document or retrieval_query

        # 5. Parallel retrieval: vector + graph (all namespaces in parallel)
        retrieval_embedding = await self._embed.embed(embed_query)

        t_vec = time.monotonic()
        ns_tasks = [
            self._retrieve_one_namespace(
                retrieval_embedding, retrieval_query, ns, req.top_k, req.use_graph
            )
            for ns in req.effective_namespaces
        ]
        ns_results = await asyncio.gather(*ns_tasks, return_exceptions=True)
        vec_ms = (time.monotonic() - t_vec) * 1000

        all_vector_lists: List[List[RerankedResult]] = []
        all_graph_entities_raw: list = []
        for ns, res in zip(req.effective_namespaces, ns_results):
            if isinstance(res, Exception):
                logger.error("Retrieval failed for namespace=%s: %s", ns, res)
                continue
            vecs, ents = res
            if vecs:
                all_vector_lists.append(vecs)
            all_graph_entities_raw.extend(ents)

        # Cross-namespace vector RRF → top_k
        if len(all_vector_lists) > 1:
            vector_results = rrf_merge(all_vector_lists, top_n=req.top_k)
        elif all_vector_lists:
            vector_results = all_vector_lists[0][:req.top_k]
        else:
            vector_results = []

        _s("vector", True, vec_ms, result_count=len(vector_results))

        # Convert graph entities to RerankedResult (deduplicated by name)
        graph_results: List[RerankedResult] = []
        graph_entities: List[dict] = []
        graph_entity_texts: List[str] = []
        seen_graph: set = set()
        for i, entity in enumerate(all_graph_entities_raw):
            payload = _graph_entity_payload(entity)
            text = payload["name"]
            if text in seen_graph:
                continue
            seen_graph.add(text)
            graph_entities.append(payload)
            graph_entity_texts.append(text)
            graph_results.append(RerankedResult(
                chunk_id=f"graph_{i}",
                document_id="graph",
                text=text,
                score=1.0 / (i + 1),
                original_rank=i,
                reranked_rank=i,
            ))

        if req.use_graph and self._graph:
            _s("graph", True, 0.0, entity_count=len(graph_entity_texts))

        # 6. RRF merge (vector + graph)
        all_lists = [r for r in [vector_results, graph_results] if r]
        merged = rrf_merge(all_lists, top_n=req.top_k) if len(all_lists) > 1 else (
            vector_results[:req.top_k] if vector_results else []
        )

        # 6.5 Apply freshness scoring + expiry filtering
        merged = apply_freshness(merged)

        retrieval_latency_ms = (time.monotonic() - t_retrieval) * 1000

        # 7. Rerank
        t = time.monotonic()
        reranked = await self._reranker.rerank(retrieval_query, merged, top_n=req.top_n_rerank)
        rerank_ms = (time.monotonic() - t) * 1000
        _s("rerank", True, rerank_ms,
           result_count=len(reranked), top_score=round(reranked[0].score if reranked else 0.0, 4))

        # Store chunk_ids in Redis for feedback tracking (non-blocking)
        if self._redis and reranked:
            asyncio.create_task(self._store_req_chunks(request_id, reranked))

        # Apply feedback boost from historical ratings
        if self._redis and reranked:
            reranked = await self._apply_feedback_boost(reranked)

        top_score = reranked[0].score if reranked else 0.0

        # 7.5 Knowledge gap detection — log when KB score is low (no auto-fetch)
        knowledge_gap = not reranked or top_score < self._policy.knowledge_gap_threshold
        if knowledge_gap:
            asyncio.create_task(
                self._log_knowledge_gap(query, req.cache_namespace_key, top_score)
            )

        # 8. Context building
        t = time.monotonic()
        context = await self._ctx_builder.build(
            retrieval_query, reranked,
            max_tokens=req.max_context_tokens,
        )
        ctx_ms = (time.monotonic() - t) * 1000
        _s("context", True, ctx_ms,
           chunk_count=len(context.chunks), truncated=context.was_truncated)

        # 9. Compression (if over budget)
        if context.was_truncated:
            compressed = await self._compressor.compress(
                retrieval_query, context, max_tokens=req.max_context_tokens
            )
            context_text = compressed.text
        else:
            context_text = "\n\n".join(c.text for c in context.chunks)

        # Inject memory context
        if memory_context:
            context_text = f"[User Memory]\n{memory_context}\n\n[Knowledge]\n{context_text}"

        # Inject graph entities
        if graph_entity_texts:
            context_text += f"\n\n[Related Entities]\n{', '.join(graph_entity_texts)}"

        # 9.5 Tool routing (optional ReAct loop)
        tool_calls_made: list = []
        if self._tool_router and req.use_tools:
            try:
                tool_calls_made = await self._tool_router.route(query, "")
                if tool_calls_made:
                    tool_results = "\n".join(
                        f"[{tc.tool_name}] {tc.output}" for tc in tool_calls_made
                    )
                    context_text = f"[Tool Results]\n{tool_results}\n\n{context_text}"
                    logger.info("Tool calls made: %s", [(tc.tool_name, tc.output) for tc in tool_calls_made])
                else:
                    logger.info("Tool router: no tools called")
            except Exception as exc:
                logger.warning("Tool router failed: %s", exc)

        # 10. Token quota check (before LLM call)
        client_id = self._resolve_client_id(req)
        if self._redis and client_id != "anonymous":
            from infrastructure.adapters.token_quota import check_and_increment_quota
            from datetime import date
            estimated_input = len(context_text.split()) + len(query.split())
            allowed, current, limit = await check_and_increment_quota(
                self._redis, client_id, estimated_input
            )
            if not allowed:
                tomorrow = date.today().isoformat()
                raise QuotaExceededError(client_id=client_id, reset_at=f"{tomorrow}T00:00:00Z")

        # 10. LLM generation
        t_gen = time.monotonic()
        kb_relevant = top_score >= self._policy.knowledge_gap_threshold
        _DIRECT_TOOLS = {"direct_answer", "datetime", "calculator", "code_executor"}
        direct_only = (
            tool_calls_made
            and len(tool_calls_made) == 1
            and tool_calls_made[0].tool_name in _DIRECT_TOOLS
            and not kb_relevant
        )
        if direct_only:
            tc = tool_calls_made[0]
            answer = str(tc.output)
        elif not context.chunks and not tool_calls_made:
            answer = "I don't have enough information to answer this question."
        else:
            if tool_calls_made and not kb_relevant:
                gen_context = "\n".join(f"[{tc.tool_name}] {tc.output}" for tc in tool_calls_made)
            else:
                gen_context = context_text
            prompt = _ANSWER_PROMPT.format(context=gen_context, query=query)
            answer = await self._llm.generate(
                prompt,
                system_prompt=_ANSWER_SYSTEM_PROMPT,
            )

        if self._redis and client_id != "anonymous":
            output_tokens = len(answer.split())
            asyncio.create_task(self._record_token_usage(client_id, output_tokens))

        generation_latency_ms = (time.monotonic() - t_gen) * 1000
        _s("llm", True, generation_latency_ms,
           answer_len=len(answer), from_tools=direct_only)

        # 10.5 Citation verification / hallucination detection
        verification: Optional[CitationVerificationResult] = None
        if context.chunks and self._citation_verifier:
            verification = self._citation_verifier.verify(answer, reranked, query)
            if verification.low_confidence:
                answer = (
                    answer
                    + f"\n\n[Note: This answer has low grounding confidence "
                    f"({verification.grounding_score:.0%}) and may contain unsupported claims.]"
                )
                asyncio.create_task(
                    self._enqueue_low_confidence(request_id, query, answer,
                                                 verification.grounding_score)
                )

        # 11. Build citations (only from vector chunks, not graph)
        citations = [
            Citation(
                chunk_id=c.chunk_id,
                document_id=c.document_id,
                filename=c.metadata.get("filename", c.document_id),
                text_snippet=c.text[:200],
                score=c.score,
                sequence_index=c.metadata.get("sequence_index", 0),
            )
            for c in context.chunks
            if c.document_id != "graph"
        ]

        result = QueryResult(
            request_id=request_id,
            answer=answer,
            citations=citations,
            graph_entities=graph_entities,
            rewritten_query=intel.rewritten_query if intel.rewritten_query != query else None,
            hyde_used=intel.hyde_used,
            sub_queries=intel.sub_queries,
            from_cache=False,
            retrieval_latency_ms=retrieval_latency_ms,
            generation_latency_ms=generation_latency_ms,
            grounding_score=verification.grounding_score if verification else 1.0,
            low_confidence=verification.low_confidence if verification else False,
            stages=stages,
            memory_context_chars=memory_context_chars,
            knowledge_gap=knowledge_gap,
            top_rerank_score=round(top_score, 4),
        )

        # 12. Cache result (only when KB has relevant answers)
        if self._cache and req.use_cache and result.citations:
            await self._cache.set(query_embedding, result, namespace=req.cache_namespace_key)

        if self._memory and req.user_id:
            asyncio.create_task(self._save_interaction_memory(
                req.user_id, query, result.answer, long_term=req.use_memory
            ))
        if result.citations:
            contexts = [c.text_snippet for c in result.citations]
            asyncio.create_task(self._run_ragas_evaluation(result.request_id, query, result.answer, contexts))

        return result

    async def _log_interaction(self, result: "QueryResult", query: str) -> None:
        try:
            pool = await self._doc_repo._get_pool()
            chunk_ids = [c.chunk_id for c in result.citations] if result.citations else []
            confidence = result.citations[0].score if result.citations else None
            await pool.execute(
                """INSERT INTO interaction_log
                   (request_id, query_text, answer_text, chunk_ids,
                    confidence_score, hyde_used, rewritten_query, sub_queries, grounding_score,
                    retrieval_latency_ms, generation_latency_ms, total_latency_ms, from_cache)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)""",
                result.request_id,
                query,
                result.answer,
                chunk_ids,
                confidence,
                result.hyde_used,
                result.rewritten_query,
                result.sub_queries or [],
                result.grounding_score,
                result.retrieval_latency_ms,
                result.generation_latency_ms,
                result.total_latency_ms,
                result.from_cache,
            )
        except Exception as exc:
            logger.debug("Failed to log interaction: %s", exc)

    async def _save_interaction_memory(self, user_id: str, query: str, answer: str, long_term: bool = False) -> None:
        """Save Q&A pair to memory. long_term=True saves to both Redis and Postgres."""
        try:
            content = f"Q: {query}\nA: {answer}"
            target = "composite" if long_term else "redis"
            await self._memory.save(
                user_id,
                content,
                {"memory_type": "conversation", "_save_target": target},
            )
        except Exception as exc:
            logger.debug("Failed to save interaction memory: %s", exc)

    async def _run_ragas_evaluation(
        self, request_id: str, query: str, answer: str, contexts: List[str]
    ) -> None:
        """Call intelligence-service to run RAGAS evaluation in background."""
        async def _call():
            import httpx
            async with httpx.AsyncClient(timeout=120.0) as client:
                await client.post(
                    f"{self._intelligence_url}/evaluation/run",
                    json={
                        "request_id": request_id,
                        "query": query,
                        "answer": answer,
                        "contexts": contexts,
                    },
                )

        try:
            await self._intelligence_breaker.call(_call)
        except CircuitOpenError as exc:
            logger.warning("Intelligence service unavailable (%s) — skipping RAGAS evaluation", exc)
        except Exception as exc:
            logger.debug("RAGAS evaluation failed: %s", exc)

    async def _record_token_usage(self, client_id: str, tokens: int) -> None:
        try:
            from infrastructure.adapters.token_quota import check_and_increment_quota
            await check_and_increment_quota(self._redis, client_id, tokens)
        except Exception as exc:
            logger.debug("Failed to record token usage: %s", exc)

    async def _enqueue_low_confidence(
        self, request_id: str, query: str, answer: str, grounding_score: float
    ) -> None:
        """Insert low-grounding-score interaction into approval_queue for admin review.

        Only enqueues when grounding_score >= 0.05 (context was retrieved but LLM
        didn't follow it). Near-zero scores mean no KB context was found — those
        are knowledge gaps, not hallucinations.
        Deduplicates by query text to avoid flooding the queue.
        """
        if grounding_score < 0.05:
            return  # No KB context at all — handled by knowledge_gap_log instead
        try:
            import hashlib
            pool = await self._doc_repo._get_pool()
            # Skip if same query already pending
            q_hash = hashlib.md5(query.lower().strip().encode()).hexdigest()
            existing = await pool.fetchrow(
                "SELECT id FROM approval_queue WHERE status='pending' AND proposed_content LIKE $1 LIMIT 1",
                f"Q: {query[:100]}%",
            )
            if existing:
                return
            candidate_id = str(uuid.uuid4())
            content = f"Q: {query}\n\nA: {answer}"
            await pool.execute(
                """INSERT INTO approval_queue
                   (id, proposed_content, supporting_interaction_ids, confidence_score, status)
                   VALUES ($1, $2, $3, $4, 'pending')""",
                candidate_id, content, [request_id], grounding_score,
            )
            logger.info(
                "Auto-enqueued low-grounding interaction %s (score=%.2f)",
                request_id, grounding_score,
            )
        except Exception as exc:
            logger.warning("Failed to enqueue for self-learning: %s", exc)

    async def _log_knowledge_gap(self, query: str, namespace: str, top_score: float) -> None:
        """Record queries where KB retrieval score fell below knowledge_gap_threshold.

        Upserts on (query_hash, namespace) so identical queries increment
        occurrence_count instead of creating duplicate rows.
        """
        import hashlib
        query_hash = hashlib.md5(query.lower().strip().encode()).hexdigest()
        try:
            pool = await self._doc_repo._get_pool()
            await pool.execute(
                """INSERT INTO knowledge_gap_log
                       (query_text, namespace, top_score, threshold, query_hash)
                   VALUES ($1, $2, $3, $4, $5)
                   ON CONFLICT (query_hash, namespace) DO UPDATE
                       SET occurrence_count = knowledge_gap_log.occurrence_count + 1,
                           last_seen        = NOW(),
                           top_score        = GREATEST(knowledge_gap_log.top_score,
                                                       EXCLUDED.top_score)
                   WHERE knowledge_gap_log.status = 'open'""",
                query, namespace, top_score, self._policy.knowledge_gap_threshold, query_hash,
            )
            logger.info(
                "Knowledge gap upserted (top_score=%.2f < threshold=%.2f) query=%r",
                top_score, self._policy.knowledge_gap_threshold, query[:80],
            )
        except Exception as exc:
            logger.debug("Failed to log knowledge gap: %s", exc)

    async def _apply_intelligence(self, query: str,
                                  req: QueryRequest) -> QueryIntelligenceResult:
        rewritten = query
        hyde_doc = None
        sub_queries: List[str] = []
        hyde_used = False

        if req.use_rewrite and self._rewriter:
            rewritten = await self._rewriter.rewrite(query)

        if req.use_hyde and self._hyde:
            hyde_doc = await self._hyde.generate_hypothetical_document(rewritten)
            hyde_used = True

        if req.use_decompose and self._decomposer:
            sub_queries = await self._decomposer.decompose(rewritten)

        return QueryIntelligenceResult(
            original_query=query,
            rewritten_query=rewritten,
            hyde_document=hyde_doc,
            sub_queries=sub_queries,
            hyde_used=hyde_used,
        )

    async def _store_req_chunks(self, request_id: str, reranked: List[RerankedResult]) -> None:
        """Store chunk_ids for this request in Redis so feedback can be linked back."""
        import json as _json
        try:
            chunk_ids = [r.chunk_id for r in reranked if not r.chunk_id.startswith("graph_")]
            if chunk_ids:
                key = f"rag:req_chunks:{request_id}"
                await self._redis.set(key, _json.dumps(chunk_ids), ex=60 * 60 * 24 * 7)  # TTL 7 days
        except Exception as exc:
            logger.debug("Failed to store req_chunks: %s", exc)

    async def _apply_feedback_boost(self, reranked: List[RerankedResult]) -> List[RerankedResult]:
        """Boost reranked scores for chunks with historically positive feedback."""
        boost_factor = float(os.getenv("FEEDBACK_BOOST_FACTOR", "0.15"))
        min_votes = int(os.getenv("FEEDBACK_BOOST_MIN_VOTES", "3"))
        if boost_factor <= 0:
            return reranked
        try:
            boosted = []
            for result in reranked:
                if result.chunk_id.startswith("graph_"):
                    boosted.append(result)
                    continue
                fb = await self._redis.hgetall(f"rag:chunk_fb:{result.chunk_id}")
                if fb:
                    good = int(fb.get("good", 0))
                    bad = int(fb.get("bad", 0))
                    total = good + bad
                    if total >= min_votes:
                        good_rate = good / total
                        boost = boost_factor * good_rate
                        from dataclasses import replace
                        result = replace(result, score=result.score * (1 + boost))
                boosted.append(result)
            # Re-sort by boosted score
            boosted.sort(key=lambda r: r.score, reverse=True)
            return boosted
        except Exception as exc:
            logger.debug("Feedback boost failed (non-fatal): %s", exc)
            return reranked
