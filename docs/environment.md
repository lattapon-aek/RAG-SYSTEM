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
| `EMBEDDING_PROVIDER` | `ollama` | When embeddings come from another provider | Embedding backend routing |
| `RERANKER_BACKEND` | `noop` | When you want active reranking | Passage reranking behavior |
| `SECRET_BACKEND` | `env` | When you move secrets to Vault/AWS | Secret source selection |
| `RAG_SERVICE_API_KEY` | empty | When you want API key enforcement on the RAG service | Enables inbound service auth for RAG |
| `INGESTION_SERVICE_API_KEY` | empty | When you want API key enforcement on ingestion | Enables inbound service auth for ingestion |
| `SERVICE_REQUIRE_DB_API_KEYS` | `false` | When you want DB-backed API keys to be mandatory | Rejects requests without a valid DB key |
| `CHUNKER_STRATEGY` | `fixed` | When you want sentence/hierarchical/semantic chunking | Ingestion chunking behavior |
| `GRAPH_EXTRACTOR_BACKEND` | `llm` | When you want faster Spacy extraction | Graph entity extraction quality vs speed |
| `CHROMA_COLLECTION_PREFIX` | `rag_1024` | When separating embeddings by dataset | Vector collection names |
| `ANALYSIS_INTERVAL_HOURS` | `24` | When changing intelligence cadence | Scheduled analysis frequency |
| `GAP_PROCESSING_INTERVAL_HOURS` | `6` | When changing gap processing cadence | Scheduled gap review frequency |
| `TRAEFIK_RATE_LIMIT_RPS` | `100` | When tuning ingress protection | Reverse proxy rate limiting |

## Minimal local seed

If you only want the stack to boot locally, start with:

```env
POSTGRES_PASSWORD=change-me-in-production
POSTGRES_URL=postgresql://postgres:change-me-in-production@postgres:5432/ragdb
NEO4J_PASSWORD=change-me-in-production
NEXTAUTH_SECRET=change-me-in-production
RERANKER_BACKEND=noop
SECRET_BACKEND=env
RAG_SERVICE_API_KEY=
INGESTION_SERVICE_API_KEY=
```

## Notes

- Most service URLs default to Docker Compose service names.
- Cloud provider keys such as `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and `TYPHOON_API_KEY` are optional unless you route traffic to those providers.
- The repo ships with extensive inline comments in `.env.example`; use that file as the source of truth for the full set of knobs.
- Docker Compose maps `RAG_SERVICE_API_KEY` and `INGESTION_SERVICE_API_KEY` into the MCP server as `MCP_RAG_SERVICE_API_KEY` and `MCP_INGESTION_SERVICE_API_KEY`.
- Memory profiles are now stored in a dedicated `memory_profiles` table so an admin can create an empty profile before the first memory entry exists.
- `api_keys` now enforces one active key per `client_id`; revoke the active key before creating a new one for the same client.

## Related docs

If you want to connect environment setup to the rest of the learning path, read:

- [Documentation index](README.md)
- [Requirement](requirement.md) for the system goals behind these variables
- [Design](design.md) for the service boundaries that consume these variables
- [Task](task.md) for the implementation areas affected by configuration
- [Create Memory Profile](../platform/dashboard/src/app/memory/create/page.tsx) for the admin-only profile creation flow
- [Service Key Registry](../platform/dashboard/src/app/api-keys/ApiKeysUI.tsx) for the active-key-per-client flow
