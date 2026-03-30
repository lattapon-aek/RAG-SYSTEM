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

## Quick Start

```bash
docker compose up -d --build
```

Main services:

- `ingestion/ingestion-service`
- `core/rag-service`
- `core/graph-service`
- `core/reranker-service`
- `intelligence/intelligence-service`
- `platform/dashboard`
- `platform/mcp-server`

## Documentation

- [English docs index](docs/README.md)
- [Thai docs index](docs/th/README.md)

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
