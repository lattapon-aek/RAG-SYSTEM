export interface CircuitBreakerStatus {
  name: string
  state: 'closed' | 'open' | 'half_open'
  failure_count: number
}

export interface MetricsSummary {
  query_volume_total: number
  avg_retrieval_latency_ms: number
  avg_generation_latency_ms: number
  avg_total_latency_ms: number
  error_rate: number
  cache_hit_rate: number
  document_count: number
  chunk_count: number
  pending_approvals: number
  avg_grounding_score: number
  knowledge_gaps_24h: number
  circuit_breakers?: CircuitBreakerStatus[]
  rate_limit?: RateLimitStats | null
}

export interface RateLimitClient {
  client_id: string
  requests_this_minute: number
  rpm_limit?: number
  has_override?: boolean
  override_source?: 'runtime' | 'persistent' | 'env' | null
}

export interface RateLimitStats {
  active_clients: number
  default_rpm: number
  top_clients: RateLimitClient[]
}

export interface RateLimitConfigStats {
  client_id: string
  requests_this_minute: number
  rpm_limit: number
  remaining_this_minute: number | null
  has_override?: boolean
  override_source?: 'runtime' | 'persistent' | 'env' | null
}

export interface NamespaceSummary {
  namespace: string
  document_count: number
  chunk_count: number
  description?: string
  entity_count?: number
  relation_count?: number
  has_vector?: boolean
  has_graph?: boolean
}

export interface QuotaStats {
  client_id: string
  tokens_used_today: number
  daily_limit: number
  remaining: number | null
  has_override?: boolean
  override_source?: 'runtime' | 'persistent' | 'env' | null
}

export interface AdminConfigAuditLogEntry {
  id: string
  admin_user_id: string | null
  action: string
  resource_type: string
  target_id: string
  before_value: Record<string, unknown> | null
  after_value: Record<string, unknown> | null
  notes: string | null
  created_at: string | null
}

export interface AdminUserRecord {
  id: string
  username: string
  role: 'viewer' | 'operator' | 'admin'
  created_at: string | null
}

export interface ApiKeyRecord {
  id: string
  client_id: string
  label: string | null
  key_prefix: string | null
  created_by: string | null
  created_at: string | null
  last_used_at: string | null
  revoked_at: string | null
}

export interface ChatIdentityRecord {
  id: string
  name: string
  description: string | null
  namespace: string
  client_id: string
  user_id: string
  created_by: string | null
  created_at: string | null
  updated_at: string | null
  revoked_at: string | null
}

export interface EvaluationSummary {
  faithfulness: number
  answer_relevance: number
  context_precision: number
  context_recall: number
  sample_count: number
}

export interface EvaluationHistory {
  id: string
  timestamp: string
  faithfulness: number
  answer_relevance: number
  context_precision: number
  context_recall: number
  query: string
}

export interface QueueStats {
  queue_depth: number
  processing: number
  failed_total: number
  recent_failures: { filename: string; error: string }[]
}

export interface KnowledgeCandidate {
  id: string
  proposed_content: string
  confidence_score: number
  status: 'pending' | 'approved' | 'rejected' | 'expired'
  created_at: string
  proposed_at?: string
  expires_at: string
  source_request_id?: string
  source_type?: 'interaction' | 'feedback' | 'feedback_cluster' | 'knowledge_gap' | 'text_ingest' | 'web_ingest' | 'file_ingest' | 'knowledge_harvest' | 'manual'
  source_label?: string | null
  source_url?: string | null
  source_title?: string | null
  source_summary?: string | null
  source_metadata?: Record<string, unknown>
  interaction_context?: string
  target_namespace?: string
}

export interface KnowledgeGap {
  id: string
  query_text: string
  namespace: string
  top_score: number
  threshold: number
  occurrence_count: number
  logged_at: string
  last_seen: string
  status: 'open' | 'promoted' | 'ignored'
}

export interface AuditLogEntry {
  id: string
  action: 'approved' | 'rejected' | 'expired'
  candidate_id: string
  admin_user_id: string | null
  timestamp: string
  notes: string | null
}

export interface FeedbackStats {
  avg_score: number
  recent_count: number
}

export interface GraphStats {
  entity_count: number
  relation_count: number
}

export interface MemoryStats {
  short_term_users: number
  short_term_entries: number
  long_term_users: number
  long_term_entries: number
}

export interface SystemConfigItem {
  key: string
  label: string
  value: string
  source: 'env' | 'fallback'
  note: string
}

export interface SystemConfigSection {
  title: string
  items: SystemConfigItem[]
}

export interface ServiceHealthItem {
  name: string
  url: string
  status: 'healthy' | 'degraded' | 'down'
  latency_ms: number | null
  detail: string | null
  checked_at: string
}

export interface SystemOverview {
  checked_at: string
  summary: {
    healthy: number
    degraded: number
    down: number
  }
  config_sections: SystemConfigSection[]
  service_health: ServiceHealthItem[]
  warnings: string[]
}
