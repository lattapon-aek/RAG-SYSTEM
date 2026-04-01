# Design

This document describes the implementation architecture used by the repository.

## Architecture style

The system follows a layered / hexagonal style:

- `domain` defines entities and errors
- `application` contains use cases and ports
- `infrastructure` contains adapters for external systems
- `interface` exposes FastAPI routers, dependencies, and auth middleware

## Service boundaries

- `core/rag-service` handles query orchestration, retrieval, reranking, memory, grounding, and context brief assembly
- `core/graph-service` handles entity extraction and graph APIs
- `core/reranker-service` isolates reranking backends, including the LLM/Typhoon reranker path
- `ingestion/ingestion-service` handles ingestion, preview, job queue, and document versioning
- `ingestion/knowledge-connector` handles knowledge collection from external sources
- `intelligence-service` handles scheduled intelligence jobs
- `platform/dashboard` provides the UI layer
- `platform/mcp-server` provides service access through MCP

## Infrastructure dependencies

The stack depends on:

- PostgreSQL / PgBouncer
- Redis
- ChromaDB
- Neo4j
- Ollama
- Jaeger
- Traefik

## Evidence in code

- `core/*`
- `ingestion/*`
- `intelligence-service/*`
- `platform/*`
- `shared/*`
- `docker-compose.yml`

## Related walkthroughs

The design layer becomes easier to follow when you trace the live request paths:

- [Ingestion walkthrough](ingestion-walkthrough.md) for the ingestion pipeline and worker flow
- [Query walkthrough](query-walkthrough.md) for retrieval, reranking, and context brief assembly

## Design-to-walkthrough map

Use this quick map when you want to jump from an architecture topic to the request flow that exercises it:

| Design topic | Read next |
|---|---|
| Layered / hexagonal boundaries | [Ingestion walkthrough](ingestion-walkthrough.md) and [Query walkthrough](query-walkthrough.md) |
| Service boundaries and data ownership | [Service Map](README.md#service-map) |
| Ingestion service internals | [Ingestion walkthrough](ingestion-walkthrough.md) |
| RAG service orchestration | [Query walkthrough](query-walkthrough.md) |
| Graph and reranker integration | [Query walkthrough](query-walkthrough.md) |
| Intelligence jobs and background analysis | [Query walkthrough](query-walkthrough.md) |
