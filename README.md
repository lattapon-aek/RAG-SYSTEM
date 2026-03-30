# RAG System

Microservices-based Retrieval Augmented Generation platform with ingestion, query, graph, intelligence, dashboard, and MCP access layers.

## Overview

This repository contains the full RAG stack for:

- document ingestion and preview
- vector retrieval and query orchestration
- graph extraction and graph querying
- reranking
- feedback / intelligence / self-learning workflows
- web admin dashboard
- MCP server integration

The implementation is split into Python FastAPI services and a Next.js dashboard, coordinated through `docker-compose.yml`.

## Repository Structure

- `core/rag-service` - main query service and retrieval pipeline
- `core/graph-service` - entity extraction and graph query APIs
- `core/reranker-service` - reranking backends
- `ingestion/ingestion-service` - file/text ingestion, preview, job queue, versioning
- `ingestion/knowledge-connector` - external knowledge acquisition and connector workflows
- `intelligence/intelligence-service` - analysis, gap processing, candidate lifecycle jobs
- `platform/dashboard` - admin and operator UI
- `platform/mcp-server` - MCP client/server bridge for the RAG stack
- `shared` - shared utilities and configuration used by multiple services
- `scripts` - DB migrations and operational scripts
- `docs` - repository-level policy and supporting documents

## What The Code Actually Does

This summary is based on the service entrypoints, route files, Docker setup, config, and tests in the repo.

### Ingestion Service

The ingestion service accepts files or plain text, normalizes MIME types, enqueues jobs in Redis, and processes them with a background worker.

Main capabilities in code:

- multipart file ingestion
- text ingestion
- preview mode without persisting the job
- job status, retry, cancel, reprocess, and queue stats
- document delete / rollback / chunk inspection
- document version tracking

Relevant code:

- `ingestion/ingestion-service/main.py`
- `ingestion/ingestion-service/interface/routers.py`
- `ingestion/ingestion-service/application/ingestion_worker.py`
- `ingestion/ingestion-service/infrastructure/adapters/job_queue.py`

### Query and Retrieval

The RAG service is the main query path. It wires retrieval, reranking, cache, memory, context building, citation verification, and model routing.

Relevant code:

- `core/rag-service/main.py`
- `core/rag-service/interface/routers.py`
- `core/rag-service/application/query_use_case.py`
- `core/rag-service/application/context_builder.py`
- `core/rag-service/application/context_compressor.py`

### Graph Service

The graph service exposes graph extraction and querying APIs backed by Neo4j and entity extractors.

Relevant code:

- `core/graph-service/main.py`
- `core/graph-service/interface/routers.py`
- `core/graph-service/application/extract_entities_use_case.py`
- `core/graph-service/application/graph_query_use_case.py`

### Intelligence Service

The intelligence service runs scheduled jobs for analysis, expiry, and gap processing.

Relevant code:

- `intelligence/intelligence-service/main.py`
- `intelligence/intelligence-service/application/evaluation_use_cases.py`
- `intelligence/intelligence-service/application/feedback_use_cases.py`
- `intelligence/intelligence-service/application/self_learning_use_cases.py`

### Knowledge Connector

This service handles external knowledge sources and connector logic.

Relevant code:

- `ingestion/knowledge-connector/main.py`
- `ingestion/knowledge-connector/interface/routers.py`
- `ingestion/knowledge-connector/application/use_cases.py`

### Platform

The dashboard is a Next.js app for operator and admin workflows. The MCP server exposes programmatic access to the services.

Relevant code:

- `platform/dashboard/package.json`
- `platform/dashboard/src/app/*`
- `platform/mcp-server/package.json`
- `platform/mcp-server/src/*`

## Documentation Check

I checked the repository for separate `Requirement`, `Design`, and `Task` documents, but there are no dedicated files with those names in this checkout.

So this README is synthesized from the source code and runtime config that actually exist:

- `docker-compose.yml`
- `rag-config.yaml`
- service entrypoints in each app
- tests under `ingestion/ingestion-service/tests` and `core/graph-service/tests`

## Runtime Dependencies

Core runtime services used by the stack:

- PostgreSQL / PgBouncer
- Redis
- ChromaDB
- Neo4j
- Ollama
- Jaeger
- Traefik

## Local Development

Typical full-stack startup:

```bash
docker compose up -d --build
```

Common service ports from `docker-compose.yml`:

- `3000` - MCP server
- `3001` - dashboard
- `8000` - RAG service
- `8001` - ingestion service
- `8002` - graph service
- `8003` - intelligence service
- `8004` - ChromaDB
- `8005` - reranker service
- `8006` - knowledge connector

## Testing

The repository includes tests for the ingestion service and graph service.

Examples:

```bash
cd ingestion/ingestion-service
pytest
```

## Notes

- Generated assets such as `node_modules`, `.next`, `dist`, `__pycache__`, and `.pytest_cache` should not be committed.
- Environment values are read from `.env` / compose variables at runtime.
