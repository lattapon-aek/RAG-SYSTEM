const INGESTION_URL = process.env.INGESTION_SERVICE_URL ?? 'http://ingestion-service:8001'
const KNOWLEDGE_URL = process.env.KNOWLEDGE_CONNECTOR_URL ?? 'http://knowledge-connector:8006'

export async function readResponseBody(res: Response) {
  const contentType = res.headers.get('content-type') ?? ''
  const raw = await res.text()
  if (contentType.includes('application/json')) {
    try {
      return raw ? JSON.parse(raw) : {}
    } catch {
      return { error: raw }
    }
  }
  try {
    return raw ? JSON.parse(raw) : {}
  } catch {
    return { error: raw || res.statusText || 'Unknown upstream error' }
  }
}

export type IngestSubmissionInput = {
  source?: 'text' | 'file' | 'web'
  namespace?: string
  url?: string
  text?: string
  filename?: string
  mime_type?: string
  file?: File | null
}

export type KnowledgeHarvestItem = {
  url: string
  status?: string
  title?: string
  description?: string
  author?: string
  published_at?: string | null
  canonical_url?: string
  site_name?: string
  language?: string
  keywords?: string[]
  status_code?: number | null
  content_type?: string
  text_length?: number
  text_preview?: string
  metadata?: Record<string, unknown>
  error?: string
}

export function filenameFromUrl(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl)
    const base = parsed.hostname.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '')
    return `${base || 'web-page'}.txt`
  } catch {
    return 'web-page.txt'
  }
}

export async function resolveIngestPreview(body: IngestSubmissionInput): Promise<{ status: number; data: any }> {
  const namespace = body.namespace?.trim() || 'default'

  if (body.source === 'file') {
    if (!body.file) {
      return { status: 400, data: { error: 'file is required' } }
    }
    const form = new FormData()
    form.append('file', body.file, body.file.name || body.filename || 'upload')
    form.append('namespace', namespace)
    form.append('content_source', 'upload')
    if (body.url?.trim()) form.append('source_url', body.url.trim())
    if (body.mime_type?.trim()) form.append('mime_type', body.mime_type.trim())
    const res = await fetch(`${INGESTION_URL}/ingest/preview`, {
      method: 'POST',
      body: form,
      cache: 'no-store',
    })
    const data = await readResponseBody(res)
    return { status: res.status, data }
  }

  if (body.source === 'web') {
    const url = body.url?.trim()
    if (!url) {
      return { status: 400, data: { error: 'url is required' } }
    }

    const harvestRes = await fetch(`${KNOWLEDGE_URL}/knowledge/batch-scrape`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        urls: [url],
        namespace,
        max_concurrency: 1,
        auto_ingest: false,
      }),
      cache: 'no-store',
    })
    const harvestData = await readResponseBody(harvestRes)
    if (!harvestRes.ok) {
      return { status: harvestRes.status, data: harvestData }
    }

    const item = Array.isArray(harvestData?.items)
      ? harvestData.items.find((entry: KnowledgeHarvestItem) => entry?.status === 'previewed') ?? harvestData.items[0]
      : null
    const previewText = String(
      item?.text_preview
      ?? item?.description
      ?? item?.title
      ?? '',
    ).trim()

    if (!previewText) {
      const upstreamItem = Array.isArray(harvestData?.items)
        ? harvestData.items.find((entry: Record<string, unknown>) => Boolean(entry?.error))
        : null
      const upstreamError = String(
        item?.error
        ?? upstreamItem?.error
        ?? harvestData?.detail
        ?? harvestData?.error
        ?? 'web preview content is empty',
      ).trim()
      return {
        status: harvestRes.ok ? 400 : harvestRes.status,
        data: {
          error: upstreamError,
          upstream: harvestData,
        },
      }
    }

    const res = await fetch(`${INGESTION_URL}/ingest/preview/text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: previewText,
        filename: body.filename?.trim() || filenameFromUrl(url),
        namespace,
        content_source: 'web',
        source_url: url,
        mime_type: String(item?.content_type ?? 'text/html'),
      }),
      cache: 'no-store',
    })
    const data = await readResponseBody(res)
    return { status: res.status, data }
  }

  const text = body.text?.trim()
  if (!text) {
    return { status: 400, data: { error: 'text is required' } }
  }

  const res = await fetch(`${INGESTION_URL}/ingest/preview/text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      filename: body.filename?.trim() || 'document.txt',
      namespace,
      content_source: 'upload',
      source_url: body.url?.trim() || null,
      mime_type: body.mime_type?.trim() || 'text/plain',
    }),
    cache: 'no-store',
  })
  const data = await readResponseBody(res)
  return { status: res.status, data }
}

export function buildApprovalCandidatePayload(body: IngestSubmissionInput, extractedText?: string, extraMetadata: Record<string, unknown> = {}) {
  const sourceMode = body.source === 'file' ? 'file_ingest' : 'text_ingest'
  const sourceUrl = body.url?.trim() || null
  const sourceTitle = String(body.filename ?? (body.source === 'file' ? 'Uploaded file' : 'Text submission')).trim() || null
  const proposedContent = String(extractedText ?? body.text ?? '').trim()
  const sourceSummary = proposedContent.slice(0, 500) || null

  return {
    proposed_content: proposedContent,
    source_request_id: `${sourceMode}:${sourceUrl ?? sourceTitle ?? 'submission'}`,
    confidence_score: 0.9,
    target_namespace: body.namespace?.trim() || 'default',
    source_type: sourceMode,
    source_label: body.source === 'file' ? 'File ingest' : 'Text ingest',
    source_url: sourceUrl,
    source_title: sourceTitle,
    source_summary: sourceSummary,
    source_metadata: {
      content_source: body.source ?? 'text',
      source_mode: body.source ?? 'text',
      mime_type: body.mime_type ?? null,
      filename: body.filename ?? null,
      source_url: sourceUrl,
      namespace: body.namespace?.trim() || 'default',
      ...extraMetadata,
    },
  }
}

export function buildHarvestApprovalCandidatePayload(
  item: KnowledgeHarvestItem,
  namespace: string,
  sourceRequestId: string,
) {
  const url = String(item.url ?? '').trim() || null
  const sourceTitle = String(item.title ?? item.canonical_url ?? item.url ?? '').trim() || null
  const proposedContent = String(item.text_preview ?? item.description ?? item.title ?? '').trim()
  const sourceSummary = String(item.text_preview ?? item.description ?? proposedContent).trim().slice(0, 500) || null

  return {
    proposed_content: proposedContent,
    source_request_id: sourceRequestId,
    confidence_score: 0.78,
    target_namespace: namespace || 'default',
    source_type: 'knowledge_harvest',
    source_label: 'Knowledge Harvest',
    source_url: url,
    source_title: sourceTitle,
    source_summary: sourceSummary,
    source_metadata: {
      url,
      title: item.title ?? null,
      description: item.description ?? null,
      author: item.author ?? null,
      published_at: item.published_at ?? null,
      canonical_url: item.canonical_url ?? null,
      site_name: item.site_name ?? null,
      language: item.language ?? null,
      keywords: item.keywords ?? [],
      status_code: item.status_code ?? null,
      content_type: item.content_type ?? null,
      text_length: item.text_length ?? null,
      text_preview: item.text_preview ?? null,
      metadata: item.metadata ?? {},
      namespace: namespace || 'default',
    },
  }
}
