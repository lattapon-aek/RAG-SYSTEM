import type {
  MetricsSummary,
  EvaluationSummary,
  EvaluationHistory,
  KnowledgeCandidate,
  QueueStats,
  KnowledgeGap,
  AuditLogEntry,
  FeedbackStats,
  NamespaceSummary,
  RateLimitStats,
  QuotaStats,
  AdminConfigAuditLogEntry,
  GraphStats,
  MemoryStats,
} from '@/types'

const RAG_SERVICE_URL = process.env.RAG_SERVICE_URL || 'http://localhost:8000'
const INTELLIGENCE_SERVICE_URL = process.env.INTELLIGENCE_SERVICE_URL || 'http://localhost:8003'
const INGESTION_SERVICE_URL = process.env.INGESTION_SERVICE_URL || 'http://localhost:8001'
const GRAPH_SERVICE_URL = process.env.GRAPH_SERVICE_URL || 'http://localhost:8002'

export async function getMetricsSummary(): Promise<MetricsSummary> {
  const res = await fetch(`${RAG_SERVICE_URL}/metrics/summary`, {
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new Error(`Failed to fetch metrics summary: ${res.status} ${res.statusText}`)
  }
  return res.json()
}

export async function getNamespaces(): Promise<NamespaceSummary[]> {
  const res = await fetch(`${RAG_SERVICE_URL}/namespaces`, {
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new Error(`Failed to fetch namespaces: ${res.status} ${res.statusText}`)
  }
  return res.json()
}

export async function getRateLimitStats(): Promise<RateLimitStats> {
  const res = await fetch(`${RAG_SERVICE_URL}/rate-limit/stats`, {
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new Error(`Failed to fetch rate limit stats: ${res.status} ${res.statusText}`)
  }
  return res.json()
}

export async function getQuotaStats(clientId: string): Promise<QuotaStats> {
  const res = await fetch(`${RAG_SERVICE_URL}/quota/${encodeURIComponent(clientId)}`, {
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new Error(`Failed to fetch quota stats: ${res.status} ${res.statusText}`)
  }
  return res.json()
}

export async function getEvaluationSummary(): Promise<EvaluationSummary> {
  const res = await fetch(`${INTELLIGENCE_SERVICE_URL}/evaluation/summary`, {
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new Error(`Failed to fetch evaluation summary: ${res.status} ${res.statusText}`)
  }
  // Map intelligence service field names (avg_*) to Dashboard type fields
  const data = await res.json()
  return {
    faithfulness: data.faithfulness ?? data.avg_faithfulness ?? 0,
    answer_relevance: data.answer_relevance ?? data.avg_answer_relevance ?? 0,
    context_precision: data.context_precision ?? data.avg_context_precision ?? 0,
    context_recall: data.context_recall ?? data.avg_context_recall ?? 0,
    sample_count: data.sample_count ?? data.total_evaluated ?? 0,
  }
}

export async function getEvaluationHistory(): Promise<EvaluationHistory[]> {
  const res = await fetch(`${INTELLIGENCE_SERVICE_URL}/evaluation/history`, {
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new Error(`Failed to fetch evaluation history: ${res.status} ${res.statusText}`)
  }
  return res.json()
}

export async function getCandidates(): Promise<KnowledgeCandidate[]> {
  const res = await fetch(`${INTELLIGENCE_SERVICE_URL}/self-learning/candidates`, {
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new Error(`Failed to fetch candidates: ${res.status} ${res.statusText}`)
  }
  return res.json()
}

export async function getCandidate(id: string): Promise<KnowledgeCandidate> {
  const res = await fetch(`${INTELLIGENCE_SERVICE_URL}/self-learning/candidates/${id}`, {
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new Error(`Failed to fetch candidate ${id}: ${res.status} ${res.statusText}`)
  }
  return res.json()
}

export async function approveCandidate(id: string): Promise<void> {
  const res = await fetch(`${INTELLIGENCE_SERVICE_URL}/self-learning/approve/${id}`, {
    method: 'POST',
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new Error(`Failed to approve candidate ${id}: ${res.status} ${res.statusText}`)
  }
}

export async function getQueueStats(): Promise<QueueStats> {
  const res = await fetch(`${INGESTION_SERVICE_URL}/ingest/queue/stats`, {
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new Error(`Failed to fetch queue stats: ${res.status} ${res.statusText}`)
  }
  return res.json()
}

export async function rejectCandidate(id: string): Promise<void> {
  const res = await fetch(`${INTELLIGENCE_SERVICE_URL}/self-learning/reject/${id}`, {
    method: 'POST',
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new Error(`Failed to reject candidate ${id}: ${res.status} ${res.statusText}`)
  }
}

export async function createApprovalCandidate(body: {
  proposed_content: string
  confidence_score: number
  source_request_id: string
  target_namespace?: string
  source_type?: string
  source_label?: string | null
  source_url?: string | null
  source_title?: string | null
  source_summary?: string | null
  source_metadata?: Record<string, unknown>
}): Promise<KnowledgeCandidate> {
  const res = await fetch(`${INTELLIGENCE_SERVICE_URL}/self-learning/candidates`, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throw new Error(`Failed to create approval candidate: ${res.status} ${res.statusText}`)
  }
  return res.json()
}

export async function getKnowledgeGaps(namespace?: string, status?: string): Promise<KnowledgeGap[]> {
  const params = new URLSearchParams()
  params.set('status', status ?? 'all')
  if (namespace) params.set('namespace', namespace)
  const res = await fetch(`${RAG_SERVICE_URL}/knowledge-gaps?${params.toString()}`, {
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new Error(`Failed to fetch knowledge gaps: ${res.status} ${res.statusText}`)
  }
  return res.json()
}

export async function promoteGap(id: string): Promise<void> {
  const res = await fetch(`${RAG_SERVICE_URL}/knowledge-gaps/${id}/promote`, {
    method: 'POST',
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new Error(`Failed to promote gap ${id}: ${res.status} ${res.statusText}`)
  }
}

export async function ignoreGap(id: string): Promise<void> {
  const res = await fetch(`${RAG_SERVICE_URL}/knowledge-gaps/${id}/ignore`, {
    method: 'POST',
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new Error(`Failed to ignore gap ${id}: ${res.status} ${res.statusText}`)
  }
}

export async function getAuditLog(limit?: number): Promise<AuditLogEntry[]> {
  const qs = limit ? `?limit=${limit}` : ''
  const res = await fetch(`${INTELLIGENCE_SERVICE_URL}/self-learning/audit-log${qs}`, {
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new Error(`Failed to fetch audit log: ${res.status} ${res.statusText}`)
  }
  return res.json()
}

export async function getAdminActionLog(limit?: number, resourceType?: string): Promise<AdminConfigAuditLogEntry[]> {
  const params = new URLSearchParams()
  if (limit) params.set('limit', String(limit))
  if (resourceType) params.set('resource_type', resourceType)
  const qs = params.toString()
  const res = await fetch(`${RAG_SERVICE_URL}/admin/action-log${qs ? `?${qs}` : ''}`, {
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new Error(`Failed to fetch admin action log: ${res.status} ${res.statusText}`)
  }
  return res.json()
}

export async function triggerAnalysis(): Promise<{ proposed: number }> {
  const res = await fetch(`${INTELLIGENCE_SERVICE_URL}/self-learning/trigger`, {
    method: 'POST',
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new Error(`Failed to trigger analysis: ${res.status} ${res.statusText}`)
  }
  return res.json()
}

export async function processGaps(): Promise<{ promoted: number }> {
  const res = await fetch(`${INTELLIGENCE_SERVICE_URL}/self-learning/process-gaps`, {
    method: 'POST',
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new Error(`Failed to process gaps: ${res.status} ${res.statusText}`)
  }
  return res.json()
}

export async function getGraphStats(): Promise<GraphStats> {
  const res = await fetch(`${GRAPH_SERVICE_URL}/graph/stats`, { cache: 'no-store' })
  if (!res.ok) return { entity_count: 0, relation_count: 0 }
  return res.json()
}

export async function getMemoryStats(): Promise<MemoryStats> {
  const res = await fetch(`${RAG_SERVICE_URL}/memory/stats`, {
    cache: 'no-store',
  })
  if (!res.ok) return { short_term_users: 0, short_term_entries: 0, long_term_users: 0, long_term_entries: 0 }
  return res.json()
}

export async function getFeedbackStats(): Promise<FeedbackStats> {
  const res = await fetch(`${INTELLIGENCE_SERVICE_URL}/feedback/stats`, {
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new Error(`Failed to fetch feedback stats: ${res.status} ${res.statusText}`)
  }
  return res.json()
}
