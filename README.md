# RAG System

[![Release Gate](https://github.com/lattapon-aek/RAG-SYSTEM/actions/workflows/release-gate.yml/badge.svg)](https://github.com/lattapon-aek/RAG-SYSTEM/actions/workflows/release-gate.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Docs](https://img.shields.io/badge/Docs-English-blue)](docs/README.md)
[![Docs TH](https://img.shields.io/badge/Docs-Thai%20supplemental-lightgrey)](docs/th/README.md)

Microservices-based Retrieval Augmented Generation platform for document ingestion, query, graph, intelligence, dashboard, and MCP access.

## Overview

RAG System is a microservices stack composed of FastAPI services, a Next.js dashboard, and an MCP server.

Core capabilities:

- document ingestion with preview, queueing, and versioning
- RAG query orchestration with retrieval, reranking, memory, caching, and citations
- graph extraction and graph querying
- intelligence jobs for analysis and self-learning
- admin and operator dashboard
- MCP-based service access

## Getting Started

1. Install Docker and Docker Compose.
2. Copy `.env.example` to `.env`.
3. Fill in the required values for PostgreSQL, Neo4j, and any optional API keys you need.
4. Start the stack:

```bash
docker compose up -d --build
```

5. Open the dashboard and service endpoints:
   - Dashboard: `http://localhost:3001`
   - RAG service: `http://localhost:8000`
   - Ingestion service: `http://localhost:8001`
   - Graph service: `http://localhost:8002`
   - Intelligence service: `http://localhost:8003`

Recommended checks:

- Confirm `docker compose ps` shows all services healthy.
- Verify `.env` values before first start.

Minimal local `.env` seed:

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

Post-start health checks:

```bash
docker compose ps
docker compose logs --tail 100
```

Service health URLs:

- `http://localhost:3001/api/health` - dashboard
- `http://localhost:8000/health` - RAG service
- `http://localhost:8001/health` - ingestion service
- `http://localhost:8002/health` - graph service
- `http://localhost:8003/health` - intelligence service

## Documentation

- [Project docs map](docs/README.md)
- [English docs index](docs/README.md)
- [Thai docs index](docs/th/README.md)
- [Environment](docs/environment.md)
- MCP-specific environment lives in [platform/mcp-server/.env.example](platform/mcp-server/.env.example)
- MCP server guide lives in [platform/mcp-server/README.md](platform/mcp-server/README.md)
- [Requirement](docs/requirement.md) for system behavior
- [Design](docs/design.md) for service boundaries
- [Task](docs/task.md) for implementation locations

Detailed notes are split into:

- [Requirement](docs/requirement.md)
- [Design](docs/design.md)
- [Task](docs/task.md)
- [Memory Profile Registry](platform/dashboard/src/app/memory-profiles/page.tsx) for admin-only profile creation
- [Service Key Registry](platform/dashboard/src/app/api-keys/ApiKeysUI.tsx) for one-active-key-per-client management

- Thai supplements:
  - [Requirement](docs/th/requirement.md)
  - [Design](docs/th/design.md)
  - [Task](docs/th/task.md)

## Docs Map

If you are learning the system, the shortest path is:

1. [Environment](docs/environment.md) - get the stack to boot
2. [Requirement](docs/requirement.md) - understand the expected behavior
3. [Design](docs/design.md) - understand the architecture and boundaries
4. [Task](docs/task.md) - inspect how the behavior is implemented in code
5. [Ingestion walkthrough](docs/ingestion-walkthrough.md) - follow one document through the ingest pipeline
6. [Query walkthrough](docs/query-walkthrough.md) - follow one question through the answer pipeline

## Flow Index

Use this as a one-page jump list when you want to open the right learning path quickly:

- [Documentation index](docs/README.md) - complete learning path and service map
- [Service map](docs/README.md#service-map) - runtime boundaries and data ownership
- [Reading graph](docs/README.md#reading-graph) - recommended order for first-time readers
- [Environment](docs/environment.md) - startup variables and local boot checklist
- [Requirement](docs/requirement.md) - what the system must do
- [Design](docs/design.md) - how the system is structured
- [Task](docs/task.md) - where the implementation lives
- [Ingestion walkthrough](docs/ingestion-walkthrough.md) - how a document becomes searchable
- [Query walkthrough](docs/query-walkthrough.md) - how a question becomes an answer

## RAG Glossary

- `retrieval` - finding the most relevant documents or chunks for a query
- `chunking` - splitting source content into smaller pieces for indexing and search
- `embedding` - converting text into vectors for semantic similarity search
- `reranking` - reordering candidate passages after initial retrieval
- `grounding` - keeping generated answers tied to source evidence
- `citation` - reporting the source passages used in an answer
- `memory` - storing reusable conversational or operational context
- `graph extraction` - turning text into entities and relationships for graph queries

## Cheat Sheet

If you want the short version of how this repo works, read these parts in order:

1. `Environment` - what must be configured before the stack can boot
2. `Ingestion service` - how files and text become queued jobs, chunks, embeddings, and graph-ready data
3. `RAG service` - how a user question becomes retrieval, reranking, grounding, and an answer
4. `Graph service` - how extracted entities become graph nodes and relationships
5. `Intelligence service` - how scheduled analysis and feedback loops run in the background
6. `Dashboard / MCP` - how humans and tools interact with the stack

## How RAG Flows Through This Repo

The practical learning path is to follow the data flow across services:

```text
User input
  -> Dashboard or MCP client
  -> RAG service or ingestion service
  -> Redis job queue or query pipeline
  -> Parser / chunker / embedding / graph / reranker adapters
  -> ChromaDB / PostgreSQL / Neo4j
  -> Answer, preview, job status, or graph result
```

Common entry points:

- `platform/dashboard` starts user-facing actions
- `platform/mcp-server` exposes programmatic access
- `ingestion/ingestion-service` handles file/text ingestion and preview
- `core/rag-service` handles question answering and retrieval
- `core/graph-service` handles graph extraction and graph queries
- `intelligence-service` handles scheduled analysis and review jobs

What to look for while reading:

- `interface/routers.py` for API shape
- `interface/dependencies.py` for wiring
- `application/*` for business flow
- `infrastructure/adapters/*` for concrete integrations

For a service-level view of the same flow, open [the service map](docs/README.md#service-map).

## Repository Layout

- `core/` - query, graph, and reranking services
- `ingestion/` - ingestion and knowledge connector services
- `intelligence-service/` - intelligence and self-learning service
- `platform/` - dashboard and MCP server
- `shared/` - shared runtime utilities
- `scripts/` - migrations and operational helpers
- `tests/` - repository-level test suite

## Notes

- Generated artifacts such as `node_modules`, `.next`, `dist`, `__pycache__`, and `.pytest_cache` are excluded from Git.
- Environment variables are loaded at runtime from `.env` / compose configuration.
