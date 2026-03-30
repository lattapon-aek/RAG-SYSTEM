# Design / การออกแบบระบบ

## English

This document describes the implementation architecture used by the repository.

### Architecture style

The system follows a layered / hexagonal style:

- `domain` defines entities and errors
- `application` contains use cases and ports
- `infrastructure` contains adapters for external systems
- `interface` exposes FastAPI routers, dependencies, and auth middleware

### Service boundaries

- `core/rag-service` handles query orchestration, retrieval, reranking, memory, and citation logic
- `core/graph-service` handles entity extraction and graph APIs
- `core/reranker-service` isolates reranking backends
- `ingestion/ingestion-service` handles ingestion, preview, job queue, and document versioning
- `ingestion/knowledge-connector` handles knowledge collection from external sources
- `intelligence/intelligence-service` handles scheduled intelligence jobs
- `platform/dashboard` provides the UI layer
- `platform/mcp-server` provides service access through MCP

### Infrastructure dependencies

The stack depends on:

- PostgreSQL / PgBouncer
- Redis
- ChromaDB
- Neo4j
- Ollama
- Jaeger
- Traefik

### Evidence in code

- `core/*`
- `ingestion/*`
- `intelligence/*`
- `platform/*`
- `shared/*`
- `docker-compose.yml`

## ภาษาไทย

เอกสารนี้อธิบายสถาปัตยกรรมที่ใช้จริงใน repo

### รูปแบบสถาปัตยกรรม

ระบบนี้ใช้แนว layered / hexagonal:

- `domain` สำหรับ entities และ errors
- `application` สำหรับ use case และ port
- `infrastructure` สำหรับ adapter ที่เชื่อมระบบภายนอก
- `interface` สำหรับ FastAPI routers, dependencies และ auth middleware

### ขอบเขตของแต่ละ service

- `core/rag-service` ดูแล query orchestration, retrieval, reranking, memory และ citation
- `core/graph-service` ดูแล entity extraction และ graph APIs
- `core/reranker-service` แยก backend สำหรับ reranking
- `ingestion/ingestion-service` ดูแล ingestion, preview, job queue และ document versioning
- `ingestion/knowledge-connector` ดูแลการเก็บความรู้จากแหล่งภายนอก
- `intelligence/intelligence-service` ดูแลงาน intelligence แบบ scheduled
- `platform/dashboard` เป็นชั้น UI
- `platform/mcp-server` เป็นชั้นเข้าถึง service ผ่าน MCP

### ระบบที่ต้องพึ่งพา

stack นี้พึ่งพา:

- PostgreSQL / PgBouncer
- Redis
- ChromaDB
- Neo4j
- Ollama
- Jaeger
- Traefik

### หลักฐานในโค้ด

- `core/*`
- `ingestion/*`
- `intelligence/*`
- `platform/*`
- `shared/*`
- `docker-compose.yml`
