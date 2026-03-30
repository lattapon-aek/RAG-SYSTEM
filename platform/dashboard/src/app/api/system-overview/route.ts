import { NextResponse } from 'next/server'
import { modelConfig } from '@/lib/model-config'

type ServiceProbe = {
  name: string
  url: string
  healthPath: string
}

const SERVICES: ServiceProbe[] = [
  { name: 'RAG Service', url: process.env.RAG_SERVICE_URL ?? 'http://rag-service:8000', healthPath: '/health' },
  { name: 'Ingestion Service', url: process.env.INGESTION_SERVICE_URL ?? 'http://ingestion-service:8001', healthPath: '/health' },
  { name: 'Graph Service', url: process.env.GRAPH_SERVICE_URL ?? 'http://graph-service:8002', healthPath: '/graph/health' },
  { name: 'Intelligence Service', url: process.env.INTELLIGENCE_SERVICE_URL ?? 'http://intelligence-service:8003', healthPath: '/health' },
]

function maskUrl(value: string): string {
  if (!value) return '—'
  try {
    const url = new URL(value)
    if (url.username || url.password) {
      url.username = url.username ? '***' : ''
      url.password = url.password ? '***' : ''
    }
    return url.toString()
  } catch {
    return value
  }
}

function envValue(key: string, fallback: string): { value: string; source: 'env' | 'fallback' } {
  const raw = process.env[key]
  return {
    value: raw ?? fallback,
    source: raw ? 'env' : 'fallback',
  }
}

function envValueAlias(keys: string[], fallback: string): { value: string; source: 'env' | 'fallback' } {
  for (const key of keys) {
    const raw = process.env[key]
    if (raw !== undefined && raw !== '') {
      return { value: raw, source: 'env' }
    }
  }
  return { value: fallback, source: 'fallback' }
}

function buildConfigSections() {
  const cfg = modelConfig()
  const providerItems = [
    {
      key: 'LLM_PROVIDER',
      label: 'Base LLM Provider',
      ...envValueAlias(['LLM_PROVIDER'], cfg.llmProvider),
      note: 'Legacy default provider for chat models (includes typhoon)',
    },
    {
      key: 'UTILITY_LLM_PROVIDER',
      label: 'Utility LLM Provider',
      ...envValueAlias(['UTILITY_LLM_PROVIDER', 'LLM_PROVIDER'], cfg.utilityLlmProvider),
      note: 'Query rewrite, HyDE, and graph extraction default provider',
    },
    {
      key: 'GENERATION_LLM_PROVIDER',
      label: 'Generation LLM Provider',
      ...envValueAlias(['GENERATION_LLM_PROVIDER', 'LLM_PROVIDER'], cfg.generationLlmProvider),
      note: 'Answer generation and drafting provider',
    },
    {
      key: 'GRAPH_LLM_PROVIDER',
      label: 'Graph LLM Provider',
      ...envValueAlias(['GRAPH_LLM_PROVIDER', 'UTILITY_LLM_PROVIDER', 'LLM_PROVIDER'], cfg.graphLlmProvider),
      note: 'Graph extraction provider',
    },
    {
      key: 'GAP_DRAFT_LLM_PROVIDER',
      label: 'Gap Draft Provider',
      ...envValueAlias(['GAP_DRAFT_LLM_PROVIDER', 'GENERATION_LLM_PROVIDER', 'LLM_PROVIDER'], cfg.gapDraftLlmProvider),
      note: 'Knowledge gap auto-drafting provider',
    },
    {
      key: 'EMBEDDING_PROVIDER',
      label: 'Embedding Provider',
      ...envValueAlias(['EMBEDDING_PROVIDER'], cfg.embeddingProvider),
      note: 'Embedding runtime provider',
    },
  ]

  const modelItems = [
    {
      key: 'LLM_MODEL',
      label: 'Base LLM',
      ...envValueAlias(['LLM_MODEL', 'OLLAMA_LLM_MODEL'], cfg.llmModel),
      note: 'Canonical model name used as the base default across providers',
    },
    {
      key: 'UTILITY_LLM_MODEL',
      label: 'Utility LLM',
      ...envValueAlias(['UTILITY_LLM_MODEL', 'LLM_MODEL', 'OLLAMA_LLM_MODEL'], cfg.utilityLlmModel),
      note: 'Query rewrite, HyDE, graph extraction, and utility flows',
    },
    {
      key: 'GENERATION_LLM_MODEL',
      label: 'Generation LLM',
      ...envValueAlias(['GENERATION_LLM_MODEL', 'LLM_MODEL', 'OLLAMA_LLM_MODEL'], cfg.generationLlmModel),
      note: 'Answer generation',
    },
    {
      key: 'GRAPH_LLM_MODEL',
      label: 'Graph LLM',
      ...envValueAlias(['GRAPH_LLM_MODEL', 'UTILITY_LLM_MODEL', 'LLM_MODEL', 'OLLAMA_LLM_MODEL'], cfg.graphLlmModel),
      note: 'Graph extraction fallback',
    },
    {
      key: 'GAP_DRAFT_LLM_MODEL',
      label: 'Gap Draft LLM',
      ...envValueAlias(['GAP_DRAFT_LLM_MODEL', 'GENERATION_LLM_MODEL', 'LLM_MODEL', 'OLLAMA_LLM_MODEL'], cfg.gapDraftLlmModel),
      note: 'Knowledge gap drafting fallback',
    },
    {
      key: 'EMBEDDING_MODEL',
      label: 'Embedding Model',
      ...envValueAlias(['EMBEDDING_MODEL', 'OLLAMA_EMBEDDING_MODEL'], cfg.embeddingModel),
      note: 'Chunk embedding and vector search',
    },
  ]

  const pipelineConfig = [
    {
      key: 'GRAPH_EXTRACTOR_BACKEND',
      label: 'Graph Extractor',
      ...envValue('GRAPH_EXTRACTOR_BACKEND', 'spacy'),
      note: 'Entity and relation extraction backend',
    },
    {
      key: 'CHUNKER_STRATEGY',
      label: 'Chunk Strategy',
      ...envValue('CHUNKER_STRATEGY', 'fixed'),
      note: 'Text splitting strategy used during ingest',
    },
    {
      key: 'SEMANTIC_CHUNK_MAX_TOKENS',
      label: 'Semantic Chunk Max',
      ...envValue('SEMANTIC_CHUNK_MAX_TOKENS', '256'),
      note: 'Upper token budget per semantic chunk',
    },
    {
      key: 'SEMANTIC_CHUNK_SIMILARITY_THRESHOLD',
      label: 'Semantic Threshold',
      ...envValue('SEMANTIC_CHUNK_SIMILARITY_THRESHOLD', '0.65'),
      note: 'Similarity cutoff for semantic splitting',
    },
    {
      key: 'GRAPH_EXTRACTOR_TIMEOUT_SECONDS',
      label: 'Graph Extract Timeout',
      ...envValue('GRAPH_EXTRACTOR_TIMEOUT_SECONDS', '180'),
      note: 'Max wait for graph extraction calls',
    },
    {
      key: 'GRAPH_SERVICE_TIMEOUT_SECONDS',
      label: 'Graph Service Timeout',
      ...envValue('GRAPH_SERVICE_TIMEOUT_SECONDS', '180'),
      note: 'Timeout for ingestion → graph service calls',
    },
    {
      key: 'RERANKER_BACKEND',
      label: 'Reranker',
      ...envValue('RERANKER_BACKEND', 'noop'),
      note: 'Retriever reranking backend',
    },
  ]

  const runtimeConfig = [
    {
      key: 'DEFAULT_NAMESPACE',
      label: 'Default Namespace',
      ...envValue('DEFAULT_NAMESPACE', 'default'),
      note: 'Fallback namespace for queries and ingest',
    },
    {
      key: 'RATE_LIMIT_DEFAULT_RPM',
      label: 'Rate Limit RPM',
      ...envValue('RATE_LIMIT_DEFAULT_RPM', '60'),
      note: 'Default API requests per minute',
    },
    {
      key: 'TOKEN_QUOTA_DEFAULT',
      label: 'Token Quota',
      ...envValue('TOKEN_QUOTA_DEFAULT', '10000'),
      note: 'Daily token budget per client',
    },
    {
      key: 'ENABLE_GRAPH',
      label: 'Graph Enabled',
      ...envValue('ENABLE_GRAPH', 'true'),
      note: 'Controls graph extraction and query path',
    },
    {
      key: 'ENABLE_MEMORY',
      label: 'Memory Enabled',
      ...envValue('ENABLE_MEMORY', 'false'),
      note: 'Short-term / long-term memory pipeline',
    },
  ]

  const infraConfig = [
    {
      key: 'RAG_SERVICE_URL',
      label: 'RAG Service URL',
      ...envValue('RAG_SERVICE_URL', 'http://rag-service:8000'),
      note: 'Main query / metrics backend',
    },
    {
      key: 'INGESTION_SERVICE_URL',
      label: 'Ingestion Service URL',
      ...envValue('INGESTION_SERVICE_URL', 'http://ingestion-service:8001'),
      note: 'Async ingest and job queue backend',
    },
    {
      key: 'GRAPH_SERVICE_URL',
      label: 'Graph Service URL',
      ...envValue('GRAPH_SERVICE_URL', 'http://graph-service:8002'),
      note: 'Graph extraction and query backend',
    },
    {
      key: 'INTELLIGENCE_SERVICE_URL',
      label: 'Intelligence Service URL',
      ...envValue('INTELLIGENCE_SERVICE_URL', 'http://intelligence-service:8003'),
      note: 'Evaluation, feedback, and self-learning backend',
    },
    {
      key: 'OLLAMA_BASE_URL',
      label: 'Ollama Base URL',
      ...envValueAlias(['OLLAMA_BASE_URL'], cfg.ollamaBaseUrl),
      note: 'LLM and embedding runtime endpoint',
    },
    {
      key: 'TYPHOON_BASE_URL',
      label: 'Typhoon Base URL',
      ...envValueAlias(['TYPHOON_BASE_URL'], cfg.typhoonBaseUrl),
      note: 'OpenAI-compatible Typhoon chat endpoint',
    },
    {
      key: 'POSTGRES_URL',
      label: 'Postgres URL',
      ...envValue('POSTGRES_URL', 'postgresql://localhost/rag'),
      note: 'Metadata and evaluation store',
    },
    {
      key: 'REDIS_URL',
      label: 'Redis URL',
      ...envValue('REDIS_URL', 'redis://redis:6379/0'),
      note: 'Queue and cache backend',
    },
    {
      key: 'CHROMA_URL',
      label: 'Chroma URL',
      ...envValue('CHROMA_URL', 'http://chromadb:8000'),
      note: 'Vector database endpoint',
    },
    {
      key: 'NEO4J_URI',
      label: 'Neo4j URI',
      ...envValue('NEO4J_URI', 'bolt://neo4j:7687'),
      note: 'Graph database endpoint',
    },
  ]

  return [
    { title: 'Providers', items: providerItems.map((item) => ({ ...item, value: item.value })) },
    { title: 'Models', items: modelItems.map((item) => ({ ...item, value: item.key.endsWith('_URL') ? maskUrl(item.value) : item.value })) },
    { title: 'Pipeline', items: pipelineConfig.map((item) => ({ ...item, value: item.value })) },
    { title: 'Runtime', items: runtimeConfig.map((item) => ({ ...item, value: item.value })) },
    { title: 'Infrastructure', items: infraConfig.map((item) => ({ ...item, value: item.key.endsWith('_URL') ? maskUrl(item.value) : item.value })) },
  ]
}

function sectionByTitle(
  sections: Array<{ title: string; items: Array<{ key: string; value: string }> }>,
  title: string,
) {
  return sections.find((section) => section.title === title)
}

async function probeService({ name, url, healthPath }: ServiceProbe) {
  const probeUrl = `${url.replace(/\/$/, '')}${healthPath}`
  const started = Date.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 3500)

  try {
    const res = await fetch(probeUrl, {
      cache: 'no-store',
      signal: controller.signal,
    })
    const latency_ms = Date.now() - started
    const body = await res.json().catch(() => ({}))
    const status = !res.ok
      ? 'down'
      : latency_ms > 2500
        ? 'degraded'
        : 'healthy'

    return {
      name,
      url,
      status,
      latency_ms,
      detail: typeof body?.service === 'string'
        ? body.service
        : typeof body?.status === 'string'
          ? body.status
          : res.ok
            ? 'healthy'
            : 'down',
      checked_at: new Date().toISOString(),
    }
  } catch (error) {
    return {
      name,
      url,
      status: 'down',
      latency_ms: null,
      detail: error instanceof Error ? error.message : 'unreachable',
      checked_at: new Date().toISOString(),
    }
  } finally {
    clearTimeout(timeout)
  }
}

export async function GET() {
  const config_sections = buildConfigSections()
  const service_health = await Promise.all(SERVICES.map(probeService))
  const healthy = service_health.filter((s) => s.status === 'healthy').length
  const degraded = service_health.filter((s) => s.status === 'degraded').length
  const down = service_health.filter((s) => s.status === 'down').length

  const warnings: string[] = []
  const providers = sectionByTitle(config_sections, 'Providers')?.items ?? []
  const models = sectionByTitle(config_sections, 'Models')?.items ?? []
  const pipeline = sectionByTitle(config_sections, 'Pipeline')?.items ?? []
  const utilityProvider = providers.find((item) => item.key === 'UTILITY_LLM_PROVIDER')?.value
  const generationProvider = providers.find((item) => item.key === 'GENERATION_LLM_PROVIDER')?.value
  const graphProvider = providers.find((item) => item.key === 'GRAPH_LLM_PROVIDER')?.value
  const llm = models.find((item) => item.key === 'UTILITY_LLM_MODEL')?.value
  const gen = models.find((item) => item.key === 'GENERATION_LLM_MODEL')?.value
  const graphBackend = pipeline.find((item) => item.key === 'GRAPH_EXTRACTOR_BACKEND')?.value
  const embed = models.find((item) => item.key === 'EMBEDDING_MODEL')?.value
  const embeddingProvider = providers.find((item) => item.key === 'EMBEDDING_PROVIDER')?.value

  if (llm && gen && llm !== gen) warnings.push(`Utility LLM and generation LLM differ (${llm} vs ${gen}).`)
  if (graphBackend === 'llm' && !embed) warnings.push('Graph extraction is LLM-based but embedding model is missing.')
  if (utilityProvider && generationProvider && utilityProvider !== generationProvider) {
    warnings.push(`Utility provider (${utilityProvider}) differs from generation provider (${generationProvider}).`)
  }
  if (graphProvider && graphProvider !== utilityProvider) warnings.push(`Graph provider (${graphProvider}) differs from utility provider (${utilityProvider}).`)
  if (embeddingProvider && embeddingProvider !== 'ollama') warnings.push(`Embedding provider is ${embeddingProvider}; Ollama warmup will be skipped for embeddings.`)
  if (down > 0) warnings.push(`${down} service(s) are down.`)
  if (degraded > 0) warnings.push(`${degraded} service(s) are degraded.`)

  return NextResponse.json({
    checked_at: new Date().toISOString(),
    summary: { healthy, degraded, down },
    config_sections,
    service_health,
    warnings,
  })
}
