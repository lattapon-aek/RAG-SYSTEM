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
ADMIN_JWT_SECRET=change-me-in-production
RERANKER_BACKEND=noop
SECRET_BACKEND=env
RAG_API_KEY=
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

- [English docs index](docs/README.md)
- [Thai docs index](docs/th/README.md)
- [Environment](docs/environment.md)

Detailed notes are split into:

- [Requirement](docs/requirement.md)
- [Design](docs/design.md)
- [Task](docs/task.md)

- Thai supplements:
  - [Requirement](docs/th/requirement.md)
  - [Design](docs/th/design.md)
  - [Task](docs/th/task.md)

## Repository Layout

- `core/` - query, graph, and reranking services
- `ingestion/` - ingestion and knowledge connector services
- `intelligence/` - intelligence and self-learning service
- `platform/` - dashboard and MCP server
- `shared/` - shared runtime utilities
- `scripts/` - migrations and operational helpers
- `tests/` - repository-level test suite

## Notes

- Generated artifacts such as `node_modules`, `.next`, `dist`, `__pycache__`, and `.pytest_cache` are excluded from Git.
- Environment variables are loaded at runtime from `.env` / compose configuration.
