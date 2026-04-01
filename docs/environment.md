# Environment

This file highlights the environment variables that matter most for local development and first run.

It is a companion to `.env.example`, not a replacement for it.

## Key variables

| Variable | Default in repo | When to change | Impact |
|---|---|---|---|
| `POSTGRES_PASSWORD` | `change-me-in-production` | Before real deployment | Protects PostgreSQL access |
| `POSTGRES_URL` | Compose-based PostgreSQL URL | When using a different DB host | Points ingestion, RAG, and intelligence services to Postgres |
| `NEO4J_PASSWORD` | `change-me-in-production` | Before real deployment | Protects Neo4j access |
| `NEXTAUTH_SECRET` | `change-me-in-production` | When enabling dashboard auth | Signs NextAuth sessions |
| `REDIS_URL` | `redis://redis:6379` | When Redis is external or clustered | Queue and cache connectivity |
| `CHROMA_URL` | `http://chromadb:8004` | When ChromaDB is external | Vector store connectivity |
| `NEO4J_URL` | `bolt://neo4j:7687` | When Neo4j is external | Graph service connectivity |
| `LLM_PROVIDER` | `ollama` | When you switch model provider | Default LLM routing |
| `QUERY_REWRITE_LLM_PROVIDER` / `QUERY_REWRITE_LLM_MODEL` | `typhoon` / `typhoon-v2.5-30b-a3b-instruct` | Query rewrite stage | LLM used to rewrite user queries before retrieval |
| `HYDE_LLM_PROVIDER` / `HYDE_LLM_MODEL` | `typhoon` / `typhoon-v2.5-30b-a3b-instruct` | HyDE stage | LLM used to generate hypothetical documents |
| `QUERY_DECOMPOSER_LLM_PROVIDER` / `QUERY_DECOMPOSER_LLM_MODEL` | `typhoon` / `typhoon-v2.5-30b-a3b-instruct` | Query decomposition stage | LLM used to split a complex query into sub-queries |
| `QUERY_SEED_LLM_PROVIDER` / `QUERY_SEED_LLM_MODEL` | `typhoon` / `typhoon-v2.5-30b-a3b-instruct` | Graph seed extraction | LLM used to extract graph seed entities from the query |
| `COMPRESSOR` | `llm` | When you want the context builder to always compress into an answer-shaped brief | Controls whether retrieval output stays raw, extractive, or LLM-compressed |
| `COMPRESSION_LLM_PROVIDER` / `COMPRESSION_LLM_MODEL` | `typhoon` / `typhoon-v2.5-30b-a3b-instruct` | Context compression | LLM used when retrieved context exceeds budget |
| `COMPRESSION_LLM_SYSTEM_PROMPT` | empty | When you want to steer compression without code changes | Customizes how the compressor condenses retrieved context for downstream use |
| `EMBEDDING_PROVIDER` | `ollama` | When embeddings come from another provider | Embedding backend routing |
| `RERANKER_BACKEND` | `llm` | When you want active reranking | Passage reranking behavior |
| `LLM_RERANKER_URL` / `LLM_RERANKER_MODEL` / `LLM_RERANKER_API_KEY` | `https://api.opentyphoon.ai/v1` / `typhoon-v2.5-30b-a3b-instruct` / empty | When you want the reranker to use Typhoon or another OpenAI-compatible provider | LLM reranking backend configuration |
| `SECRET_BACKEND` | `env` | When you move secrets to Vault/AWS | Secret source selection |
| `RAG_SERVICE_API_KEY` | empty | When you want API key enforcement on the RAG service | Enables inbound service auth for RAG |
| `INGESTION_SERVICE_API_KEY` | empty | When you want API key enforcement on ingestion | Enables inbound service auth for ingestion |
| `SERVICE_REQUIRE_DB_API_KEYS` | `false` | When you want DB-backed API keys to be mandatory | Rejects requests without a valid DB key |
| `CHUNKER_STRATEGY` | `fixed` | When you want sentence/hierarchical/semantic chunking | Ingestion chunking behavior |
| `GRAPH_EXTRACTOR_BACKEND` | `llm` | When you want a lighter heuristic fallback than LLM | Graph entity extraction quality vs speed |
| `GRAPH_ENTITY_MAX_TOKENS` | `4096` | When you want to raise or lower the graph LLM budget | Maximum token budget for graph extraction calls |
| `GRAPH_ENTITY_SYSTEM_PROMPT` | empty | When you want to steer graph extraction without code changes | Customizes the graph extractor's LLM behavior |
| `GRAPH_QUERY_SEED_SYSTEM_PROMPT` | empty | When you want to steer query-side graph seed extraction without code changes | Customizes how the RAG query pipeline extracts graph seed entities |
| `GRAPH_QUERY_SEED_MAX_TOKENS` | `512` | When seed extraction needs a larger or smaller JSON output budget | Maximum token budget for query-side graph seed extraction |
| `CHROMA_COLLECTION_PREFIX` | `rag_1024` | When separating embeddings by dataset | Vector collection names |
| `ANALYSIS_INTERVAL_HOURS` | `24` | When changing intelligence cadence | Scheduled analysis frequency |
| `GAP_PROCESSING_INTERVAL_HOURS` | `6` | When changing gap processing cadence | Scheduled gap review frequency |
| `TRAEFIK_RATE_LIMIT_RPS` | `100` | When tuning ingress protection | Reverse proxy rate limiting |

ChromaDB now runs with a dedicated vector profile in `docker-compose.yml` because it sits on the retrieval hot path. The current profile is `0.25 CPU / 512 MB RAM / 80 pids`; if vector search still feels slow, this is the first place to raise.

## Minimal local seed

If you only want the stack to boot locally, start with:

```env
POSTGRES_PASSWORD=change-me-in-production
POSTGRES_URL=postgresql://postgres:change-me-in-production@postgres:5432/ragdb
NEO4J_PASSWORD=change-me-in-production
NEXTAUTH_SECRET=change-me-in-production
  RERANKER_BACKEND=llm
SECRET_BACKEND=env
RAG_SERVICE_API_KEY=
INGESTION_SERVICE_API_KEY=
```

## Notes

- Most service URLs default to Docker Compose service names.
- Cloud provider keys such as `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and `TYPHOON_API_KEY` are optional unless you route traffic to those providers.
- `GRAPH_ENTITY_MAX_TOKENS` controls the graph LLM budget. Increase it if your prompt grows large enough that the provider rejects the call.
- `GRAPH_ENTITY_SYSTEM_PROMPT` lets you tune graph extraction behavior from env when you want to keep the code path stable but adjust graph ontology or extraction style.
- `GRAPH_QUERY_SEED_SYSTEM_PROMPT` and `GRAPH_QUERY_SEED_MAX_TOKENS` control the query-side seed extractor that decides which entities to send into Graph augmentation before retrieval.
- The repo ships with extensive inline comments in `.env.example`; use that file as the source of truth for the full set of knobs.
- The MCP server has its own isolated env file at `platform/mcp-server/.env`; copy from `platform/mcp-server/.env.example` when you want to run MCP separately from the main RAG stack.
- Memory profiles are now stored in a dedicated `memory_profiles` table so an admin can create an empty profile before the first memory entry exists.
- `api_keys` now enforces one active key per `client_id`; revoke the active key before creating a new one for the same client.

## Related docs

If you want to connect environment setup to the rest of the learning path, read:

- [Documentation index](README.md)
- [Requirement](requirement.md) for the system goals behind these variables
- [Design](design.md) for the service boundaries that consume these variables
- [Task](task.md) for the implementation areas affected by configuration
- [Memory Profile Registry](../platform/dashboard/src/app/memory-profiles/page.tsx) for the admin-only profile creation flow
- [Service Key Registry](../platform/dashboard/src/app/api-keys/ApiKeysUI.tsx) for the active-key-per-client flow
