# Requirement

This document summarizes the system requirements that are reflected in the current codebase.

## Core requirements

- Document ingestion from file upload and raw text
- Preview mode before ingestion
- Background job queue for ingestion
- Job status, retry, cancel, reprocess, and queue statistics
- Document version history and rollback
- Document chunk inspection
- Vector retrieval and RAG-style answer generation
- Graph extraction and graph querying
- Reranking support
- Intelligence workflows for analysis, feedback, and self-learning
- Admin dashboard for operations
- Admin-only memory profile creation and memory entry management
- One active service key per client_id in the key registry
- MCP access for programmatic integration

## Evidence in code

- `docker-compose.yml`
- `rag-config.yaml`
- `ingestion/ingestion-service/interface/routers.py`
- `core/rag-service/interface/routers.py`
- `core/graph-service/interface/routers.py`
- `intelligence/intelligence-service/main.py`
- `platform/dashboard/src/app/*`
- `platform/mcp-server/src/*`
- `tests/*`

## Related walkthroughs

If you want to see these requirements as real request flows, read:

- [Ingestion walkthrough](ingestion-walkthrough.md)
- [Query walkthrough](query-walkthrough.md)

## Requirement-to-walkthrough map

Use this quick map when you want to jump from a requirement to the code path that implements it:

| Requirement area | Read next |
|---|---|
| Document ingestion, preview, queue, status, retry, cancel, rollback, chunk inspection | [Ingestion walkthrough](ingestion-walkthrough.md) |
| Vector retrieval, RAG answer generation, reranking, cache, memory, citation | [Query walkthrough](query-walkthrough.md) |
| Graph extraction and graph querying | [Ingestion walkthrough](ingestion-walkthrough.md) and [Query walkthrough](query-walkthrough.md) |
| Intelligence workflows and background analysis | [Query walkthrough](query-walkthrough.md) |
| Dashboard and MCP access | [Query walkthrough](query-walkthrough.md) and [Ingestion walkthrough](ingestion-walkthrough.md) |
| Memory profile creation and memory management | [Query walkthrough](query-walkthrough.md) |
| Service key registry and unique active client keys | [Task](task.md) and [Environment](environment.md) |
