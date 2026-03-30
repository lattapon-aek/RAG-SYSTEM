/**
 * HTTP client for Ingestion Service (:8001)
 */

import { ingestionHeaders } from "./service-auth.js";

const INGESTION_SERVICE_URL = process.env.INGESTION_SERVICE_URL ?? "http://ingestion-service:8001";

async function fetchJSON(url: string, options: RequestInit = {}): Promise<unknown> {
  const res = await fetch(url, {
    headers: ingestionHeaders({ "Content-Type": "application/json" }),
    ...options,
  });
  const body = await res.json();
  if (!res.ok) {
    const msg = (body as { detail?: string }).detail ?? res.statusText;
    throw new Error(`[ingestion-service] ${res.status}: ${msg}`);
  }
  return body;
}

export async function ingestText(params: {
  content: string;
  filename?: string;
  content_type?: string;
  namespace?: string;
  chunker?: string;
  metadata?: Record<string, unknown>;
}): Promise<unknown> {
  // ingestion-service /ingest/text expects "text" not "content"
  const { content, ...rest } = params;
  return fetchJSON(`${INGESTION_SERVICE_URL}/ingest/text`, {
    method: "POST",
    body: JSON.stringify({ text: content, ...rest }),
  });
}
