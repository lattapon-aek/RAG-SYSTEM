/**
 * HTTP client for RAG Service (:8000)
 */

import { ragHeaders } from "./service-auth.js";

const RAG_SERVICE_URL = process.env.RAG_SERVICE_URL ?? "http://rag-service:8000";

async function fetchJSON(url: string, options: RequestInit = {}): Promise<unknown> {
  const res = await fetch(url, {
    headers: ragHeaders({ "Content-Type": "application/json" }),
    ...options,
  });
  const body = await res.json();
  if (!res.ok) {
    const msg = (body as { detail?: string }).detail ?? res.statusText;
    throw new Error(`[rag-service] ${res.status}: ${msg}`);
  }
  return body;
}

export async function ragQuery(params: {
  query: string;
  namespace?: string;
  namespaces?: string[];
  user_id?: string;
  top_k?: number;
  top_n_rerank?: number;
  use_cache?: boolean;
  force_refresh?: boolean;
  use_memory?: boolean;
  use_hyde?: boolean;
  use_rewrite?: boolean;
  use_decompose?: boolean;
  use_graph?: boolean;
  stream?: boolean;
}): Promise<unknown> {
  if (params.stream) {
    return ragQueryStream(params);
  }
  return fetchJSON(`${RAG_SERVICE_URL}/query`, {
    method: "POST",
    body: JSON.stringify(params),
  });
}

/**
 * Call /query/stream, collect all SSE events, and return an assembled result.
 * MCP tools must return complete responses, so streaming is collected server-side.
 */
async function ragQueryStream(params: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${RAG_SERVICE_URL}/query/stream`, {
    method: "POST",
    headers: ragHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = (body as { detail?: string }).detail ?? res.statusText;
    throw new Error(`[rag-service] ${res.status}: ${msg}`);
  }

  let answer = "";
  let citations: unknown[] = [];
  let doneEvent: Record<string, unknown> = {};

  const text = await res.text();
  for (const line of text.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    try {
      const event = JSON.parse(line.slice(6)) as Record<string, unknown>;
      if (event.type === "token") answer += (event.content as string) ?? "";
      else if (event.type === "citations") {
        citations = (event.citations as unknown[]) ?? [];
        doneEvent = { ...doneEvent, ...event };
      } else if (event.type === "done") {
        doneEvent = { ...doneEvent, ...event };
      } else if (event.type === "error") {
        throw new Error(String(event.message));
      }
    } catch {
      // skip malformed lines
    }
  }

  return { answer, citations, ...doneEvent };
}

export async function ragListDocuments(namespace = "default"): Promise<unknown> {
  return fetchJSON(`${RAG_SERVICE_URL}/documents?namespace=${encodeURIComponent(namespace)}`);
}

export async function ragDeleteDocument(document_id: string): Promise<unknown> {
  return fetchJSON(`${RAG_SERVICE_URL}/documents/${encodeURIComponent(document_id)}`, {
    method: "DELETE",
  });
}

export async function ragMetricsSummary(): Promise<unknown> {
  return fetchJSON(`${RAG_SERVICE_URL}/metrics/summary`);
}

export async function memoryGet(user_id: string, query = ""): Promise<unknown> {
  return fetchJSON(`${RAG_SERVICE_URL}/memory/get`, {
    method: "POST",
    body: JSON.stringify({ user_id, query }),
  });
}

export async function memorySave(user_id: string, content: string, metadata?: Record<string, unknown>): Promise<unknown> {
  return fetchJSON(`${RAG_SERVICE_URL}/memory/save`, {
    method: "POST",
    body: JSON.stringify({ user_id, content, metadata }),
  });
}

export async function memoryList(user_id: string): Promise<unknown> {
  return fetchJSON(`${RAG_SERVICE_URL}/memory/${encodeURIComponent(user_id)}`);
}

export async function memoryDelete(user_id: string, memory_id: string): Promise<unknown> {
  return fetchJSON(`${RAG_SERVICE_URL}/memory/${encodeURIComponent(user_id)}/${encodeURIComponent(memory_id)}`, {
    method: "DELETE",
  });
}

export async function listNamespaces(): Promise<unknown> {
  return fetchJSON(`${RAG_SERVICE_URL}/namespaces`);
}

export async function setNamespaceDescription(namespace: string, description?: string): Promise<unknown> {
  return fetchJSON(`${RAG_SERVICE_URL}/namespaces/${encodeURIComponent(namespace)}`, {
    method: "PUT",
    body: JSON.stringify({ description: description ?? null }),
  });
}

export async function deleteNamespace(namespace: string): Promise<unknown> {
  return fetchJSON(`${RAG_SERVICE_URL}/namespaces/${encodeURIComponent(namespace)}`, {
    method: "DELETE",
  });
}
