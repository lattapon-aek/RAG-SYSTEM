type HeaderMap = Record<string, string>

function buildHeaders(extra?: HeaderMap, apiKey?: string): Headers {
  const headers = new Headers(extra ?? {})
  if (apiKey) {
    headers.set("X-API-Key", apiKey)
  }
  return headers
}

export function ragHeaders(extra?: HeaderMap): Headers {
  return buildHeaders(extra, process.env.RAG_SERVICE_API_KEY)
}

export function ingestionHeaders(extra?: HeaderMap): Headers {
  return buildHeaders(extra, process.env.INGESTION_SERVICE_API_KEY ?? process.env.RAG_SERVICE_API_KEY)
}

export function knowledgeHeaders(extra?: HeaderMap): Headers {
  return buildHeaders(extra, process.env.KNOWLEDGE_CONNECTOR_API_KEY)
}
