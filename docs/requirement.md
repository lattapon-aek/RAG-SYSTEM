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
