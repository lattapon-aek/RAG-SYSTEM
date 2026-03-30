/**
 * HTTP client for Intelligence Service (:8003)
 */

const INTELLIGENCE_SERVICE_URL = process.env.INTELLIGENCE_SERVICE_URL ?? "http://intelligence-service:8003";

async function fetchJSON(url: string, options: RequestInit = {}): Promise<unknown> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const body = await res.json();
  if (!res.ok) {
    const msg = (body as { detail?: string }).detail ?? res.statusText;
    throw new Error(`[intelligence-service] ${res.status}: ${msg}`);
  }
  return body;
}

export async function getPendingApprovals(): Promise<unknown> {
  return fetchJSON(`${INTELLIGENCE_SERVICE_URL}/self-learning/candidates`);
}

export async function triggerLearning(): Promise<unknown> {
  return fetchJSON(`${INTELLIGENCE_SERVICE_URL}/self-learning/trigger`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function listKnowledgeGaps(status?: string): Promise<unknown> {
  const params = status ? `?status=${encodeURIComponent(status)}` : "";
  return fetchJSON(`${INTELLIGENCE_SERVICE_URL}/self-learning/gaps${params}`);
}

export async function promoteGap(id: string): Promise<unknown> {
  return fetchJSON(`${INTELLIGENCE_SERVICE_URL}/self-learning/gaps/${encodeURIComponent(id)}/promote`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function processGaps(): Promise<unknown> {
  return fetchJSON(`${INTELLIGENCE_SERVICE_URL}/self-learning/process-gaps`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function createCandidate(params: {
  proposed_content: string;
  confidence_score: number;
  source_request_id: string;
  target_namespace?: string;
  source_type?: string;
  source_label?: string;
  source_url?: string;
  source_title?: string;
  source_summary?: string;
  source_metadata?: Record<string, unknown>;
}): Promise<unknown> {
  return fetchJSON(`${INTELLIGENCE_SERVICE_URL}/self-learning/candidates`, {
    method: "POST",
    body: JSON.stringify(params),
  });
}
