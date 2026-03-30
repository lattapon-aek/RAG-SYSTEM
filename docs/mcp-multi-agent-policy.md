# MCP Multi-Agent Policy

This RAG system is intended to support multiple AI agents through one MCP entry point while keeping admin control in the dashboard.

## Goal

- Let agents use the knowledge base as a shared source of truth.
- Keep destructive or operational controls out of the agent surface.
- Route review, approval, and learning operations through the dashboard.

## Agent-Facing Tool Set

Use these tools for normal agent work:

- `rag_query`
- `rag_ingest`
- `rag_list_documents`
- `knowledge_batch_scrape`
- `memory_get`
- `memory_save`
- `memory_list`
- `memory_delete`
- `platform_kb_stats`
- `platform_list_namespaces`

## Dashboard/Admin-Facing Flow

Keep these actions in the dashboard or backend admin flow, not in MCP:

- Candidate review
- Approve / reject
- Trigger learning
- Process gaps
- Namespace maintenance
- Deletion actions

## Removed From MCP

These were intentionally removed from the agent-facing MCP surface:

- `rag_delete_document`
- `platform_set_namespace_description`
- `platform_delete_namespace`
- `platform_pending_approvals`
- `platform_trigger_learning`
- `platform_list_knowledge_gaps`
- `platform_promote_gap`
- `platform_process_gaps`

## Multi-Agent Conventions

- Use one namespace per knowledge domain or project.
- Use a stable `user_id` per human or agent identity.
- Treat `memory_*` as short contextual memory, not as a dumping ground for long-term knowledge.
- Prefer `rag_query` for retrieval and `rag_ingest` for durable knowledge updates.
- Do not give agents delete or admin capabilities unless you explicitly want autonomous operations.

## Practical Recommendation

- Agent tools should be permissive for retrieval and ingestion.
- Administrative actions should remain human-controlled in the dashboard.
- This keeps the system safe while still supporting multiple agents at the same time.
