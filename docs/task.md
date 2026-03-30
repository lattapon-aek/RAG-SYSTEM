# Task

This document groups the main implementation tasks that exist in the repository.

If you want to see these tasks as real execution paths, read:

- [Ingestion walkthrough](ingestion-walkthrough.md)
- [Query walkthrough](query-walkthrough.md)

## Ingestion tasks

- Implement file and text ingestion endpoints
- Build Redis-backed ingestion queue
- Run a background ingestion worker
- Add preview, retry, cancel, reprocess, and status endpoints
- Add document deletion, rollback, and chunk inspection endpoints
- Add document version tracking

## Query / graph tasks

- Implement the main RAG query pipeline
- Add retrieval, reranking, cache, memory, and citation support
- Implement graph extraction and graph querying
- Add adapters for ChromaDB, Neo4j, and model providers

## Intelligence tasks

- Schedule analysis and expiry jobs
- Process knowledge gaps
- Persist feedback and approval workflow data

## Platform tasks

- Build the Next.js dashboard
- Add admin screens for jobs, documents, graph, cache, memory, and approvals
- Expose MCP clients for service access

## Evidence in code

- `ingestion/ingestion-service/*`
- `core/rag-service/*`
- `core/graph-service/*`
- `intelligence/intelligence-service/*`
- `platform/dashboard/*`
- `platform/mcp-server/*`
- `tests/*`
