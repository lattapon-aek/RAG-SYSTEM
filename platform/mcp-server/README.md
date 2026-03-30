# MCP Server

This directory contains the standalone MCP server that proxies access to the RAG system.

## What this server does

- Exposes MCP tools for query, retrieval, ingestion, memory, feedback, and related workflows.
- Applies per-client rate limiting using `client_id`.
- Sends service auth headers when calling RAG and ingestion services.

## How to run it separately

1. Copy [`platform/mcp-server/.env.example`](./.env.example) to [`platform/mcp-server/.env`](./.env).
2. Set the service endpoints for the environment where this MCP server will run.
3. Set `MCP_RAG_SERVICE_API_KEY` and `MCP_INGESTION_SERVICE_API_KEY` to the service keys that the MCP server should send.
4. Adjust `MCP_RATE_LIMIT_DEFAULT_RPM` and `MCP_RATE_LIMIT_OVERRIDES` if you want different per-client limits.
5. Start it through the main Compose stack or as a standalone Node process.

## Key files

- [`src/index.ts`](./src/index.ts) - MCP tool definitions and server entrypoint.
- [`src/rate-limiter.ts`](./src/rate-limiter.ts) - client_id-based rate limiting.
- [`src/service-auth.ts`](./src/service-auth.ts) - outgoing service auth headers.
- [`.env.example`](./.env.example) - isolated MCP runtime config.

## Notes

- Keep this server's env separate from the main RAG stack env.
- `client_id` is for quota and rate limiting; API keys are for service authentication.
- The plain API key used by MCP should be treated as a secret.
