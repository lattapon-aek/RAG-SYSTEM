# Design

This document describes the implementation architecture used by the repository.

## Architecture style

The system follows a layered / hexagonal style:

- `domain` defines entities and errors
- `application` contains use cases and ports
- `infrastructure` contains adapters for external systems
- `interface` exposes FastAPI routers, dependencies, and auth middleware

## Service boundaries

- `core/rag-service` handles query orchestration, retrieval, reranking, memory, and citation logic
- `core/graph-service` handles entity extraction and graph APIs
- `core/reranker-service` isolates reranking backends
- `ingestion/ingestion-service` handles ingestion, preview, job queue, and document versioning
- `ingestion/knowledge-connector` handles knowledge collection from external sources
- `intelligence/intelligence-service` handles scheduled intelligence jobs
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
- `intelligence/*`
- `platform/*`
- `shared/*`
- `docker-compose.yml`
