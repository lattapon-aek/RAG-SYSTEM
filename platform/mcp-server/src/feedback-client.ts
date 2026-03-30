/**
 * HTTP client for Intelligence Service feedback endpoints (:8003)
 */

const INTELLIGENCE_SERVICE_URL = process.env.INTELLIGENCE_SERVICE_URL ?? "http://intelligence-service:8003";

async function fetchJSON(url: string, options: RequestInit = {}): Promise<unknown> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (body as { detail?: string }).detail ?? res.statusText;
    throw new Error(`[intelligence-service] ${res.status}: ${msg}`);
  }
  return body;
}

export async function feedbackSubmit(params: {
  request_id: string;
  feedback_score: number;
  query_text?: string;
  comment?: string;
  category?: string;
  namespace?: string;
  user_id?: string;
  source_type?: string;
  source_id?: string;
}): Promise<unknown> {
  return fetchJSON(`${INTELLIGENCE_SERVICE_URL}/feedback/submit`, {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function feedbackStats(days = 14): Promise<unknown> {
  return fetchJSON(`${INTELLIGENCE_SERVICE_URL}/feedback/analytics?days=${encodeURIComponent(String(days))}`);
}
