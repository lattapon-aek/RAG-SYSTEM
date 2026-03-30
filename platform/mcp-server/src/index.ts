import { createServer } from "http";
import { randomUUID } from "crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import * as ragClient from "./rag-client.js";
import * as knowledgeClient from "./knowledge-client.js";
import * as intelligenceClient from "./intelligence-client.js";
import * as feedbackClient from "./feedback-client.js";
import { checkRateLimit, extractClientId } from "./rate-limiter.js";

// ---------------------------------------------------------------------------
// Input schemas (Zod)
// ---------------------------------------------------------------------------

const RagQuerySchema = z.object({
  query: z.string().min(1, "query must not be empty"),
  namespace: z.string().optional(),
  namespaces: z.array(z.string()).max(5).optional(),
  user_id: z.string().optional(),
  top_k: z.number().int().positive().optional(),
  top_n_rerank: z.number().int().positive().optional(),
  use_cache: z.boolean().optional(),
  force_refresh: z.boolean().optional(),
  use_memory: z.boolean().optional(),
  use_hyde: z.boolean().optional(),
  use_rewrite: z.boolean().optional(),
  use_decompose: z.boolean().optional(),
  use_graph: z.boolean().optional(),
  stream: z.boolean().optional().describe("Stream tokens via SSE (collected before returning)"),
});

const RagIngestSchema = z.object({
  content: z.string().min(1, "content must not be empty"),
  filename: z.string().optional(),
  content_type: z.string().optional(),
  namespace: z.string().optional(),
  chunker: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const RagListDocumentsSchema = z.object({
  namespace: z.string().optional(),
});

const KnowledgeBatchScrapeSchema = z.object({
  urls: z.array(z.string().url()).min(1),
  namespace: z.string().optional(),
  max_concurrency: z.number().int().positive().max(6).optional(),
});

const MemoryGetSchema = z.object({
  user_id: z.string().min(1),
  query: z.string().optional(),
});

const MemorySaveSchema = z.object({
  user_id: z.string().min(1),
  content: z.string().min(1),
  metadata: z.record(z.unknown()).optional(),
});

const MemoryListSchema = z.object({
  user_id: z.string().min(1),
});

const MemoryDeleteSchema = z.object({
  user_id: z.string().min(1),
  memory_id: z.string().min(1),
});

const FeedbackSubmitSchema = z.object({
  request_id: z.string().min(1),
  feedback_score: z.number().min(0).max(1),
  query_text: z.string().optional(),
  comment: z.string().optional(),
  category: z.string().optional(),
  namespace: z.string().optional(),
  user_id: z.string().optional(),
  source_type: z.string().optional(),
  source_id: z.string().optional(),
});

const FeedbackStatsSchema = z.object({
  days: z.number().int().positive().max(90).optional(),
});

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOLS = [
  // RAG Core
  {
    name: "rag_query",
    description: "Query the RAG knowledge base and get an answer with citations.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The question to ask" },
        namespace: { type: "string", description: "Knowledge namespace (default: 'default')" },
        namespaces: { type: "array", items: { type: "string" }, maxItems: 5, description: "Query multiple namespaces in parallel (overrides namespace). Call platform_list_namespaces first to discover available namespaces." },
        user_id: { type: "string", description: "User ID for memory context" },
        top_k: { type: "number", description: "Number of chunks to retrieve (default: 10)" },
        top_n_rerank: { type: "number", description: "Number of results after reranking (default: 5)" },
        use_cache: { type: "boolean", description: "Use semantic cache (default: true)" },
        force_refresh: { type: "boolean", description: "Bypass cache (default: false)" },
        use_memory: { type: "boolean", description: "Inject user memory context (default: false)" },
        use_hyde: { type: "boolean", description: "Use HyDE query expansion (default: false)" },
        use_rewrite: { type: "boolean", description: "Rewrite query with LLM (default: false)" },
        use_decompose: { type: "boolean", description: "Decompose complex query (default: false)" },
        use_graph: { type: "boolean", description: "Include graph entity context (default: true)" },
      },
      required: ["query"],
    },
  },
  {
    name: "rag_ingest",
    description: "Submit text content into the approval queue for human review before ingestion.",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Text content to ingest" },
        filename: { type: "string", description: "Source filename" },
        content_type: { type: "string", description: "MIME type (default: text/plain)" },
        namespace: { type: "string", description: "Target namespace (default: 'default')" },
        chunker: { type: "string", description: "Chunker strategy: fixed|sentence|hierarchical|semantic" },
        metadata: { type: "object", description: "Additional metadata" },
      },
      required: ["content"],
    },
  },
  {
    name: "rag_list_documents",
    description: "List all documents in the knowledge base.",
    inputSchema: {
      type: "object",
      properties: {
        namespace: { type: "string", description: "Namespace to list (default: 'default')" },
      },
    },
  },
  // Knowledge Connector
  {
    name: "knowledge_batch_scrape",
    description: "Submit multiple web URLs into the approval queue for human review before ingestion.",
    inputSchema: {
      type: "object",
      properties: {
        urls: { type: "array", items: { type: "string" }, description: "URLs to process", minItems: 1 },
        namespace: { type: "string", description: "Target namespace (default: 'default')" },
        max_concurrency: { type: "number", description: "Maximum concurrent requests (default: 3, max: 6)" },
      },
      required: ["urls"],
    },
  },
  // Memory
  {
    name: "memory_get",
    description: "Retrieve relevant memory entries for a user.",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string", description: "User ID" },
        query: { type: "string", description: "Query to find relevant memories" },
      },
      required: ["user_id"],
    },
  },
  {
    name: "memory_save",
    description: "Save a memory entry for a user.",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string", description: "User ID" },
        content: { type: "string", description: "Memory content to save" },
        metadata: { type: "object", description: "Optional metadata" },
      },
      required: ["user_id", "content"],
    },
  },
  {
    name: "memory_list",
    description: "List all memory entries for a user.",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string", description: "User ID" },
      },
      required: ["user_id"],
    },
  },
  {
    name: "memory_delete",
    description: "Delete a specific memory entry for a user.",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string", description: "User ID" },
        memory_id: { type: "string", description: "Memory entry ID to delete" },
      },
      required: ["user_id", "memory_id"],
    },
  },
  // Feedback
  {
    name: "feedback_submit",
    description: "Submit feedback for a query/answer pair so the system can learn from it.",
    inputSchema: {
      type: "object",
      properties: {
        request_id: { type: "string", description: "Interaction request ID" },
        feedback_score: { type: "number", description: "Feedback score from 0.0 to 1.0" },
        query_text: { type: "string", description: "Original query text (recommended)" },
        comment: { type: "string", description: "Optional human or agent comment" },
        category: { type: "string", description: "Feedback category (general, wrong_answer, incomplete, off_topic, hallucination)" },
        namespace: { type: "string", description: "Namespace context for the feedback" },
        user_id: { type: "string", description: "User ID, when available" },
        source_type: { type: "string", description: "Source type such as chat, mcp_agent, manual" },
        source_id: { type: "string", description: "Source identifier such as agent id or message id" },
      },
      required: ["request_id", "feedback_score"],
    },
  },
  {
    name: "feedback_stats",
    description: "Get feedback analytics and trends.",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "number", description: "Window size in days (default: 14)" },
      },
    },
  },
  // Platform
  {
    name: "platform_kb_stats",
    description: "Get knowledge base statistics (document count, chunk count, cache hit rate, etc.).",
    inputSchema: {
      type: "object",
      properties: {
        namespace: { type: "string", description: "Filter stats by namespace (optional)" },
      },
    },
  },
  {
    name: "platform_list_namespaces",
    description: "List all namespaces with document/chunk counts and description. Call this first to discover available namespaces before querying.",
    inputSchema: { type: "object", properties: {} },
  },
];

const PlatformListNamespacesSchema = z.object({});

// ---------------------------------------------------------------------------
// Helper: validate input and throw MCP error on failure
// ---------------------------------------------------------------------------

function validate<T>(schema: z.ZodSchema<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const messages = result.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ");
    throw new McpError(ErrorCode.InvalidParams, `Validation failed: ${messages}`);
  }
  return result.data;
}

function wrapError(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  throw new McpError(ErrorCode.InternalError, message);
}

// ---------------------------------------------------------------------------
// Server setup
// ---------------------------------------------------------------------------

const server = new Server(
  { name: "rag-mcp-server", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // Rate limit check
  const clientId = extractClientId(args);
  const rl = await checkRateLimit(clientId);
  if (!rl.allowed) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      `Rate limit exceeded (${rl.current}/${rl.limit} rpm). Retry after ${rl.retry_after}s.`,
    );
  }

  try {
    switch (name) {
      // --- RAG Core ---
      case "rag_query": {
        const params = validate(RagQuerySchema, args);
        const result = await ragClient.ragQuery(params);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
  case "rag_ingest": {
        const params = validate(RagIngestSchema, args);
        const result = await intelligenceClient.createCandidate({
          proposed_content: params.content,
          confidence_score: 1.0,
          source_request_id: randomUUID(),
          target_namespace: params.namespace ?? "default",
          source_type: "rag_ingest",
          source_label: params.filename ?? "MCP text ingest",
          source_metadata: {
            filename: params.filename,
            content_type: params.content_type,
            chunker: params.chunker,
            metadata: params.metadata ?? {},
          },
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
      case "rag_list_documents": {
        const params = validate(RagListDocumentsSchema, args);
        const result = await ragClient.ragListDocuments(params.namespace);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      // --- Knowledge Connector ---
      case "knowledge_batch_scrape": {
        const params = validate(KnowledgeBatchScrapeSchema, args);
        const result = await knowledgeClient.batchScrape({ ...params, auto_ingest: false, include_text: true });
        const payload = result as {
          items?: Array<Record<string, unknown>>;
          namespace?: string;
          total?: number;
          succeeded?: number;
          failed?: number;
        };
        const items = Array.isArray(payload.items) ? payload.items : [];
        const submitted: Array<Record<string, unknown>> = [];
        for (const item of items) {
          if (item.status !== "scraped" && item.status !== "previewed") continue;
          const text = String(item.text ?? item.text_preview ?? "").trim();
          if (!text) continue;
          const sourceUrl = String(item.url ?? "");
          const candidate = await intelligenceClient.createCandidate({
            proposed_content: text,
            confidence_score: 0.9,
            source_request_id: sourceUrl || randomUUID(),
            target_namespace: params.namespace ?? (payload.namespace as string | undefined) ?? "default",
            source_type: "web",
            source_label: String(item.title ?? sourceUrl ?? "web page"),
            source_url: sourceUrl || undefined,
            source_title: String(item.title ?? ""),
            source_summary: String(item.description ?? item.text_preview ?? "").slice(0, 1000),
            source_metadata: {
              ...(typeof item.metadata === "object" && item.metadata !== null ? item.metadata as Record<string, unknown> : {}),
              canonical_url: item.canonical_url,
              content_type: item.content_type,
              keywords: item.keywords,
              status_code: item.status_code,
              source_status: item.status,
            },
          });
          const candidateObj = candidate as Record<string, unknown>;
          submitted.push({
            candidate_id: candidateObj.id,
            request_id: candidateObj.source_request_id,
            status: candidateObj.status,
            source_url: candidateObj.source_url ?? sourceUrl,
            target_namespace: candidateObj.target_namespace ?? params.namespace ?? payload.namespace ?? "default",
          });
        }
        return {
          content: [{
            type: "text",
            text: JSON.stringify(
              {
                total: payload.total ?? items.length,
                succeeded: payload.succeeded ?? submitted.length,
                failed: payload.failed ?? 0,
                submitted: submitted.length,
                candidates: submitted,
              },
              null,
              2,
            ),
          }],
        };
      }

      // --- Memory ---
      case "memory_get": {
        const params = validate(MemoryGetSchema, args);
        const result = await ragClient.memoryGet(params.user_id, params.query);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
      case "memory_save": {
        const params = validate(MemorySaveSchema, args);
        const result = await ragClient.memorySave(params.user_id, params.content, params.metadata as Record<string, unknown> | undefined);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
      case "memory_list": {
        const params = validate(MemoryListSchema, args);
        const result = await ragClient.memoryList(params.user_id);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
      case "memory_delete": {
        const params = validate(MemoryDeleteSchema, args);
        const result = await ragClient.memoryDelete(params.user_id, params.memory_id);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      // --- Feedback ---
      case "feedback_submit": {
        const params = validate(FeedbackSubmitSchema, args);
        const result = await feedbackClient.feedbackSubmit({
          request_id: params.request_id,
          feedback_score: params.feedback_score,
          query_text: params.query_text,
          comment: params.comment,
          category: params.category,
          namespace: params.namespace,
          user_id: params.user_id,
          source_type: params.source_type,
          source_id: params.source_id,
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
      case "feedback_stats": {
        const params = validate(FeedbackStatsSchema, args);
        const result = await feedbackClient.feedbackStats(params.days ?? 14);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      // --- Platform ---
      case "platform_kb_stats": {
        const result = await ragClient.ragMetricsSummary();
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
      case "platform_list_namespaces": {
        const result = await ragClient.listNamespaces();
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
  } catch (err) {
    if (err instanceof McpError) throw err;
    wrapError(err);
  }
});

// ---------------------------------------------------------------------------
// Health HTTP server (for Docker healthcheck)
// ---------------------------------------------------------------------------

function startHealthServer(port = 3000) {
  const httpServer = createServer((req, res) => {
    if (req.url === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "healthy", service: "mcp-server" }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  httpServer.listen(port, () => {
    console.error(`Health server listening on :${port}`);
  });
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
  startHealthServer(Number(process.env.HEALTH_PORT ?? 3000));
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("RAG MCP Server running on stdio");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
