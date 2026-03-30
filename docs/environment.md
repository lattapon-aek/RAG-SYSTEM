# Environment

This file highlights the environment variables that matter most for local development and first run.

It is a companion to `.env.example`, not a replacement for it.

## Required for local boot

- `POSTGRES_PASSWORD`
- `POSTGRES_URL`
- `NEO4J_PASSWORD`
- `NEXTAUTH_SECRET`
- `ADMIN_JWT_SECRET`

## Recommended first-run values

- `REDIS_URL=redis://redis:6379`
- `CHROMA_URL=http://chromadb:8004`
- `NEO4J_URL=bolt://neo4j:7687`
- `LLM_PROVIDER=ollama`
- `EMBEDDING_PROVIDER=ollama`
- `RERANKER_BACKEND=noop`
- `SECRET_BACKEND=env`
- `RAG_API_KEY=` if you want local requests without API key enforcement

## Commonly tuned values

- `CHUNKER_STRATEGY`
- `GRAPH_EXTRACTOR_BACKEND`
- `LLM_MODEL`
- `UTILITY_LLM_MODEL`
- `GENERATION_LLM_MODEL`
- `EMBEDDING_MODEL`
- `CHROMA_COLLECTION_PREFIX`
- `ANALYSIS_INTERVAL_HOURS`
- `GAP_PROCESSING_INTERVAL_HOURS`
- `TRAEFIK_RATE_LIMIT_RPS`

## Notes

- Most service URLs default to Docker Compose service names.
- Cloud provider keys such as `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and `TYPHOON_API_KEY` are optional unless you route traffic to those providers.
- The repo ships with extensive inline comments in `.env.example`; use that file as the source of truth for the full set of knobs.
