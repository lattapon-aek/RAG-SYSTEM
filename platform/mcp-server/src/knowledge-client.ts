/**
 * HTTP client for Knowledge Connector (:8006)
 */

import { knowledgeHeaders } from "./service-auth.js";

const KNOWLEDGE_CONNECTOR_URL = process.env.KNOWLEDGE_CONNECTOR_URL ?? "http://knowledge-connector:8006";

async function fetchJSON(url: string, options: RequestInit = {}): Promise<unknown> {
  const res = await fetch(url, {
    headers: knowledgeHeaders({ "Content-Type": "application/json" }),
    ...options,
  });
  const body = await res.json();
  if (!res.ok) {
    const msg = (body as { detail?: string }).detail ?? res.statusText;
    throw new Error(`[knowledge-connector] ${res.status}: ${msg}`);
  }
  return body;
}

export async function pageMetadata(params: {
  url: string;
}): Promise<unknown> {
  return fetchJSON(`${KNOWLEDGE_CONNECTOR_URL}/knowledge/page-metadata`, {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function queryDb(params: {
  connection_string: string;
  query: string;
  db_type?: string;
}): Promise<unknown> {
  return fetchJSON(`${KNOWLEDGE_CONNECTOR_URL}/knowledge/query-db`, {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function fetchNews(params: {
  feed_url: string;
  max_items?: number;
}): Promise<unknown> {
  return fetchJSON(`${KNOWLEDGE_CONNECTOR_URL}/knowledge/news-feed?feed_url=${encodeURIComponent(params.feed_url)}&max_items=${params.max_items ?? 10}`);
}

export async function batchScrape(params: {
  urls: string[];
  namespace?: string;
  auto_ingest?: boolean;
  include_text?: boolean;
  max_concurrency?: number;
}): Promise<unknown> {
  return fetchJSON(`${KNOWLEDGE_CONNECTOR_URL}/knowledge/batch-scrape`, {
    method: "POST",
    body: JSON.stringify(params),
  });
}
