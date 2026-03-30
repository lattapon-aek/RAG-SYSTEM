# MCP Server

Standalone MCP runtime for the RAG system.

## Quick Checklist

1. Copy [`platform/mcp-server/.env.example`](./.env.example) to [`platform/mcp-server/.env`](./.env) for local/dev, or copy [`platform/mcp-server/.env.production.example`](./.env.production.example) for a standalone deployment.
2. Set the service endpoints (`RAG_SERVICE_URL`, `INGESTION_SERVICE_URL`, `KNOWLEDGE_CONNECTOR_URL`, `INTELLIGENCE_SERVICE_URL`).
3. Set `MCP_RAG_SERVICE_API_KEY` and `MCP_INGESTION_SERVICE_API_KEY`.
4. Set `MCP_CLIENT_ID` and the `MCP_RATE_LIMIT_*` values if you need custom limits.
5. Start the container or run `npm run build && npm start` from this directory.

## What It Does

- Exposes MCP tools for query, retrieval, ingestion, memory, feedback, and related workflows.
- Applies per-client rate limiting using `client_id`.
- Sends service auth headers when calling RAG and ingestion services.

## Key Files

- [`src/index.ts`](./src/index.ts) - MCP tool definitions and server entrypoint.
- [`src/rate-limiter.ts`](./src/rate-limiter.ts) - client_id-based rate limiting.
- [`src/service-auth.ts`](./src/service-auth.ts) - outgoing service auth headers.
- [`.env.example`](./.env.example) - local/dev runtime config.
- [`.env.production.example`](./.env.production.example) - standalone/prod runtime config.

## Notes

- Keep this server's env separate from the main RAG stack env.
- `client_id` is for quota and rate limiting; API keys are for service authentication.
- The plaintext API key used by MCP should be treated as a secret.
