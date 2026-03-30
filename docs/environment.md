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
| `ADMIN_JWT_SECRET` | `change-me-in-production` | When enabling admin auth | Signs admin JWTs |
| `REDIS_URL` | `redis://redis:6379` | When Redis is external or clustered | Queue and cache connectivity |
| `CHROMA_URL` | `http://chromadb:8004` | When ChromaDB is external | Vector store connectivity |
| `NEO4J_URL` | `bolt://neo4j:7687` | When Neo4j is external | Graph service connectivity |
| `LLM_PROVIDER` | `ollama` | When you switch model provider | Default LLM routing |
| `EMBEDDING_PROVIDER` | `ollama` | When embeddings come from another provider | Embedding backend routing |
| `RERANKER_BACKEND` | `noop` | When you want active reranking | Passage reranking behavior |
| `SECRET_BACKEND` | `env` | When you move secrets to Vault/AWS | Secret source selection |
| `RAG_API_KEY` | empty | When you want API key enforcement | Enables simple service auth |
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
ADMIN_JWT_SECRET=change-me-in-production
RERANKER_BACKEND=noop
SECRET_BACKEND=env
RAG_API_KEY=
```

## Notes

- Most service URLs default to Docker Compose service names.
- Cloud provider keys such as `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and `TYPHOON_API_KEY` are optional unless you route traffic to those providers.
- The repo ships with extensive inline comments in `.env.example`; use that file as the source of truth for the full set of knobs.

## Related docs

If you want to connect environment setup to the rest of the learning path, read:

- [Documentation index](README.md)
- [Requirement](requirement.md) for the system goals behind these variables
- [Design](design.md) for the service boundaries that consume these variables
- [Task](task.md) for the implementation areas affected by configuration
