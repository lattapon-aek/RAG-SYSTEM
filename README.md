# RAG System

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Microservices-based Retrieval Augmented Generation platform for document ingestion, query, graph, intelligence, dashboard, and MCP access.

## Highlights

- Ingestion service with file/text upload, preview, job queue, and versioning
- RAG query service with retrieval, reranking, memory, caching, and citation support
- Graph service for entity extraction and graph queries
- Intelligence service for scheduled analysis and self-learning workflows
- Next.js dashboard for admin and operator workflows
- MCP server for programmatic access to the stack

## Quick Start

```bash
docker compose up -d --build
```

## Main Ports

- `3000` - MCP server
- `3001` - dashboard
- `8000` - RAG service
- `8001` - ingestion service
- `8002` - graph service
- `8003` - intelligence service
- `8004` - ChromaDB
- `8005` - reranker service
- `8006` - knowledge connector

## Documentation

- [Documentation index](docs/README.md)
- [Requirement](docs/requirement.md)
- [Design](docs/design.md)
- [Task](docs/task.md)

Thai supplemental docs:

- [Requirement - Thai](docs/th/requirement.md)
- [Design - Thai](docs/th/design.md)
- [Task - Thai](docs/th/task.md)

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
