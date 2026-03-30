'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import dynamic from 'next/dynamic'
import Tabs from '@/components/Tabs'

// ForceGraph3D loaded lazily inside GraphCanvas via useState to preserve ref access


// ─── Types ────────────────────────────────────────────────────────────────────

interface Document {
  id: string
  filename: string
  content_type: string
  namespace: string
  chunk_count: number
  ingested_at?: string
}

interface Chunk {
  chunk_id: string
  document_id: string
  sequence_index: number
  text: string
  char_count: number
}

interface RetrieveChunk {
  chunk_id: string
  document_id: string
  filename: string
  text_snippet: string
  score: number
  sequence_index: number
  stage: string
}

interface StageTimingInfo {
  stage: string
  fired: boolean
  latency_ms: number
  meta?: Record<string, unknown>
}

interface RetrieveResult {
  query: string
  chunks: RetrieveChunk[]
  graph_entities: Array<{ name: string; type: string }>
  retrieval_latency_ms: number
  total_chunks_before_rerank: number
  // pipeline stage metadata
  stages?: StageTimingInfo[]
  cache_hit?: boolean
  cached_answer?: string
  memory_context_chars?: number
  rewritten_query?: string
  hyde_used?: boolean
  embed_latency_ms?: number
  vector_latency_ms?: number
  graph_latency_ms?: number
  rerank_latency_ms?: number
  knowledge_gap?: boolean
  top_rerank_score?: number
}

interface FullQueryResult {
  request_id: string
  answer: string
  citations: RetrieveChunk[]
  graph_entities: Array<{ name: string; type: string }>
  rewritten_query?: string
  hyde_used?: boolean
  from_cache?: boolean
  retrieval_latency_ms: number
  generation_latency_ms: number
  total_latency_ms: number
  grounding_score: number
  low_confidence: boolean
  stages?: StageTimingInfo[]
  memory_context_chars?: number
  knowledge_gap?: boolean
  top_rerank_score?: number
  sub_queries?: string[]
}

// Maps backend stage names → pipeline node IDs
const STAGE_TO_NODE: Record<string, string> = {
  embed: 'query',
  cache: 'cache',
  short_memory: 'shortmem',
  long_memory: 'longmem',
  q_intel: 'qintel',
  vector: 'vector',
  graph: 'graph',
  rerank: 'rerank',
  context: 'context',
  llm: 'llm',
}

interface PipelineExtras {
  rewrittenQuery?: string
  hydeUsed?: boolean
  topK?: number
  topN?: number
}

interface PipelineData {
  status: 'idle' | 'loading' | 'done'
  mode: 'retrieve' | 'full'
  activeNodes: Set<string>
  nodeTimings: Map<string, number>
  nodeMeta: Map<string, Record<string, unknown>>
  cacheHit: boolean
  cachedAnswer?: string
  extras?: PipelineExtras
}

const EMPTY_PIPELINE: PipelineData = {
  status: 'idle', mode: 'retrieve',
  activeNodes: new Set(), nodeTimings: new Map(), nodeMeta: new Map(),
  cacheHit: false,
}

interface SystemConfig {
  llmProvider: string
  utilityLlmProvider: string
  generationLlmProvider: string
  graphLlmProvider: string
  gapDraftLlmProvider: string
  embeddingProvider: string
  llmModel: string
  utilityLlmModel: string
  generationLlmModel: string
  graphLlmModel: string
  gapDraftLlmModel: string
  embeddingModel: string
  semanticCacheThreshold: string
  enableMemory: string
  memoryBackend: string
  vectorStore: string
  enableGraph: string
  graphExtractorBackend: string
  rerankerBackend: string
  compressor: string
  contextCompressionThreshold: string
  contextDedupOverlapThreshold: string
  knowledgeGapThreshold: string
}

function buildPipelineData(
  stages: StageTimingInfo[],
  mode: 'retrieve' | 'full',
  cacheHit: boolean,
  cachedAnswer?: string,
  extras?: PipelineExtras,
): PipelineData {
  const activeNodes = new Set<string>()
  const nodeTimings = new Map<string, number>()
  const nodeMeta = new Map<string, Record<string, unknown>>()
  for (const s of stages) {
    if (!s.fired) continue
    const nid = STAGE_TO_NODE[s.stage]
    if (!nid) continue
    activeNodes.add(nid)
    if (s.latency_ms > 0) nodeTimings.set(nid, s.latency_ms)
    if (s.meta) nodeMeta.set(nid, s.meta)
  }
  if (activeNodes.has('vector') || activeNodes.has('rerank')) activeNodes.add('chunks')
  if (cacheHit) { activeNodes.add('query'); activeNodes.add('cache') }
  return { status: 'done', mode, activeNodes, nodeTimings, nodeMeta, cacheHit, cachedAnswer, extras }
}

interface GraphEntity {
  name: string
  type: string
  id?: string
}

interface GraphRelation {
  source: string
  target: string
  relation_type: string
}

interface CacheEntry {
  key: string
  request_id?: string
  namespace: string
  query_text?: string
  answer_snippet: string
  citations_count: number
  ttl_seconds: number
}

interface MemoryEntry {
  id: string
  content: string
  created_at: string
  metadata?: Record<string, unknown>
  source?: string
}

interface MemoryUser {
  user_id: string
  entry_count: number
  last_updated?: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'retrieval', label: 'Retrieval Preview' },
  { id: 'documents', label: 'Documents' },
  { id: 'chunks', label: 'Chunk Inspector' },
  { id: 'graph', label: 'Graph Browser' },
  { id: 'memory', label: 'Memory' },
  { id: 'cache', label: 'Cache' },
]

// ─── Complete RAG Pipeline ────────────────────────────────────────────────────

interface PNode {
  id: string; label: string; sublabel?: string; icon: string
  x: number; y: number; w: number; h: number
  color: string
  group: 'always' | 'retrieve' | 'retrieve-graph' | 'full'
}

// viewBox: 0 0 790 230
// Columns: Query | User Context | Q.Intel | Retrieval | Reranker | Generation | Out
const PIPELINE_NODES: PNode[] = [
  { id: 'query',    label: 'Query In',        icon: '⬦',  sublabel: 'embed → vector',           x: 4,   y: 101, w: 70,  h: 26, color: '#4b5563', group: 'always' },
  { id: 'cache',    label: 'Semantic Cache',  icon: '⚡', sublabel: 'Redis',                    x: 96,  y: 36,  w: 94,  h: 26, color: '#7c3aed', group: 'full' },
  { id: 'shortmem', label: 'Short Memory',   icon: '◎',  sublabel: 'Redis · user_id',           x: 96,  y: 101, w: 94,  h: 26, color: '#0891b2', group: 'full' },
  { id: 'longmem',  label: 'Long Memory',    icon: '⊙',  sublabel: 'PG · user_id',              x: 96,  y: 166, w: 94,  h: 26, color: '#0891b2', group: 'full' },
  { id: 'qintel',   label: 'Query Intel.',   icon: '✦',  sublabel: 'rewrite/HyDE',              x: 212, y: 101, w: 92,  h: 26, color: '#8b5cf6', group: 'full' },
  { id: 'vector',   label: 'Vector Search',  icon: '⊕',  sublabel: 'ChromaDB',                  x: 328, y: 68,  w: 92,  h: 26, color: '#2563eb', group: 'retrieve' },
  { id: 'graph',    label: 'Graph Augment',  icon: '⬡',  sublabel: 'Neo4j',                     x: 328, y: 140, w: 92,  h: 26, color: '#059669', group: 'retrieve-graph' },
  { id: 'rerank',   label: 'Reranker',       icon: '⇅',  sublabel: 'BGE / Cohere',              x: 444, y: 101, w: 82,  h: 26, color: '#d97706', group: 'retrieve' },
  { id: 'context',  label: 'Context Builder',icon: '⊞',                                         x: 552, y: 68,  w: 94,  h: 26, color: '#dc2626', group: 'full' },
  { id: 'llm',      label: 'LLM Generation', icon: '◆',                                         x: 552, y: 140, w: 94,  h: 26, color: '#6d28d9', group: 'full' },
  { id: 'chunks',   label: 'Chunks Out',     icon: '▣',  sublabel: '← preview result',          x: 672, y: 101, w: 84,  h: 26, color: '#f59e0b', group: 'retrieve' },
]

type EdgeType = 'full' | 'retrieve' | 'retrieve-graph'
const PIPELINE_EDGES: [string, string, EdgeType][] = [
  // Full-query path (shown dim — these steps are SKIPPED in retrieve preview)
  ['query',    'cache',    'full'],
  ['query',    'shortmem', 'full'],
  ['query',    'longmem',  'full'],
  ['query',    'qintel',   'full'],   // direct path when cache/memory disabled but qintel fires (HyDE/rewrite)
  ['cache',    'qintel',   'full'],
  ['shortmem', 'qintel',   'full'],
  ['longmem',  'qintel',   'full'],
  ['qintel',   'vector',   'full'],
  ['qintel',   'graph',    'full'],
  ['rerank',   'context',  'full'],
  ['context',  'llm',      'full'],
  ['llm',      'chunks',   'full'],
  // Retrieve-only path (ACTIVE in preview — shortcuts directly to vector/graph)
  ['query',  'vector', 'retrieve'],
  ['query',  'graph',  'retrieve-graph'],
  ['vector', 'rerank', 'retrieve'],
  ['graph',  'rerank', 'retrieve-graph'],
  ['rerank', 'chunks', 'retrieve'],
]

// ─── Node popup — data-first per-node renderer ────────────────────────────────

const NODE_PURPOSE: Record<string, string> = {
  query:    'Converts query text → dense embedding vector',
  cache:    'Semantic similarity lookup in Redis',
  shortmem: 'Loads recent conversation turns for this user',
  longmem:  'Loads long-term user knowledge from PostgreSQL',
  qintel:   'Rewrites query and/or generates HyDE document',
  vector:   'Cosine-similarity search in ChromaDB',
  graph:    'Traverses Neo4j entity graph for related context',
  rerank:   'Cross-encoder re-scores candidate chunks',
  context:  'Assembles final LLM context window',
  llm:      'Generates grounded answer from context',
  chunks:   'Final ranked chunks — retrieval output',
}

function ScoreBar({ value, max = 1 }: { value: number; max?: number }) {
  const pct = Math.min((value / max) * 100, 100)
  const color = value >= 0.9 ? '#22c55e' : value >= 0.7 ? '#f59e0b' : value >= 0.5 ? '#f97316' : '#ef4444'
  return (
    <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
    </div>
  )
}

function Pill({ children, color = 'gray' }: { children: React.ReactNode; color?: string }) {
  const cls: Record<string, string> = {
    green:  'bg-green-900/40 text-green-300',
    amber:  'bg-amber-900/40 text-amber-300',
    violet: 'bg-violet-900/40 text-violet-300',
    pink:   'bg-pink-900/40 text-pink-300',
    blue:   'bg-blue-900/40 text-blue-300',
    emerald:'bg-emerald-900/40 text-emerald-300',
    red:    'bg-red-900/40 text-red-300',
    gray:   'bg-gray-700/40 text-gray-400',
  }
  return <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${cls[color] ?? cls.gray}`}>{children}</span>
}

function StatGrid({ items }: { items: { label: string; value: React.ReactNode }[] }) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {items.map(({ label, value }) => (
        <div key={label} className="bg-gray-800 rounded-lg px-2.5 py-2">
          <div className="text-[9px] text-gray-600 uppercase tracking-wider mb-0.5">{label}</div>
          <div className="text-[11px] text-gray-200 font-medium">{value}</div>
        </div>
      ))}
    </div>
  )
}

function ConfigBlock({ items }: { items: { env: string; value: string }[] }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg px-2.5 py-2">
      <div className="text-[8px] text-gray-600 uppercase tracking-widest mb-1.5">ENV Config</div>
      <div className="space-y-1">
        {items.map(({ env, value }) => (
          <div key={env} className="flex items-center justify-between gap-2 font-mono">
            <span className="text-[9px] text-gray-500 truncate">{env}</span>
            <span className="text-[9px] text-amber-400 font-semibold shrink-0">{value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function renderNodeBody(
  nodeId: string,
  meta: Record<string, unknown> | undefined,
  timing: number | undefined,
  isActive: boolean,
  isPending: boolean,
  extras: PipelineExtras | undefined,
  status: PipelineData['status'],
  vectorMeta: Record<string, unknown> | undefined,
  cfg: SystemConfig | null,
): React.ReactNode {
  const ms = (t: number | undefined) => t != null ? `${t.toFixed(1)} ms` : '—'

  if (isPending) return <p className="text-violet-400 text-[11px] animate-pulse">Waiting for LLM response…</p>
  if (status === 'idle') return <p className="text-gray-600 text-[11px]">Run a query to see live data for this stage.</p>

  if (nodeId === 'query') {
    return isActive ? (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-2xl font-bold text-white">{ms(timing)}</span>
          <Pill color="green">✓ embedded</Pill>
        </div>
        <StatGrid items={[
          { label: 'Model', value: cfg?.embeddingModel ?? 'bge-m3' },
          { label: 'Vector dim', value: '768' },
        ]} />
        {cfg && <ConfigBlock items={[
          { env: 'EMBEDDING_PROVIDER', value: cfg.embeddingProvider },
          { env: 'EMBEDDING_MODEL', value: cfg.embeddingModel },
        ]} />}
      </div>
    ) : <p className="text-gray-500 text-[11px]">Stage not yet run.</p>
  }

  if (nodeId === 'cache') {
    if (!isActive) return <p className="text-gray-500 text-[11px]">Cache disabled — enable <span className="text-violet-400">Cache</span> toggle to use.</p>
    const hit = meta?.hit as boolean | undefined
    return (
      <div className="space-y-2">
        {hit === true ? (
          <div className="rounded-lg bg-violet-900/50 border border-violet-700 px-3 py-2.5 text-center">
            <div className="text-violet-300 text-lg font-bold">⚡ HIT</div>
            <div className="text-[10px] text-violet-500 mt-0.5">Pipeline short-circuited — all downstream stages skipped</div>
          </div>
        ) : (
          <div className="rounded-lg bg-gray-800 border border-gray-700 px-3 py-2.5 text-center">
            <div className="text-gray-300 text-lg font-bold">✗ MISS</div>
            <div className="text-[10px] text-gray-600 mt-0.5">No similar query in cache — continuing to retrieval</div>
          </div>
        )}
        <StatGrid items={[{ label: 'Lookup latency', value: ms(timing) }]} />
        {cfg && <ConfigBlock items={[{ env: 'SEMANTIC_CACHE_THRESHOLD', value: cfg.semanticCacheThreshold }]} />}
      </div>
    )
  }

  if (nodeId === 'shortmem') {
    if (!isActive) return <p className="text-gray-500 text-[11px]">Memory disabled — enable <span className="text-cyan-400">Memory</span> toggle and set a user_id.</p>
    const count = meta?.entry_count as number | undefined
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-2xl font-bold text-white">{count ?? 0}</span>
          <span className="text-gray-400 text-sm">recent turns loaded</span>
        </div>
        <StatGrid items={[{ label: 'Latency', value: ms(timing) }, { label: 'Store', value: 'Redis' }]} />
        {(count ?? 0) === 0 && <p className="text-[10px] text-gray-600">No conversation history found for this user_id.</p>}
        {cfg && <ConfigBlock items={[
          { env: 'ENABLE_MEMORY',  value: cfg.enableMemory },
          { env: 'MEMORY_BACKEND', value: cfg.memoryBackend },
        ]} />}
      </div>
    )
  }

  if (nodeId === 'longmem') {
    if (!isActive) return <p className="text-gray-500 text-[11px]">Memory disabled — enable <span className="text-cyan-400">Memory</span> toggle and set a user_id.</p>
    const count = meta?.entry_count as number | undefined
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-2xl font-bold text-white">{count ?? 0}</span>
          <span className="text-gray-400 text-sm">long-term entries loaded</span>
        </div>
        <StatGrid items={[{ label: 'Latency', value: ms(timing) }, { label: 'Store', value: 'PostgreSQL' }]} />
        {(count ?? 0) === 0 && <p className="text-[10px] text-gray-600">No long-term memory synthesised yet for this user.</p>}
        {cfg && <ConfigBlock items={[
          { env: 'ENABLE_MEMORY',  value: cfg.enableMemory },
          { env: 'MEMORY_BACKEND', value: cfg.memoryBackend },
        ]} />}
      </div>
    )
  }

  if (nodeId === 'qintel') {
    if (!isActive) return <p className="text-gray-500 text-[11px]">Disabled — enable <span className="text-purple-400">Rewrite</span> or <span className="text-pink-400">HyDE</span> to run this stage.</p>
    const rewrote = meta?.rewritten as boolean | undefined
    const hyde = meta?.hyde as boolean | undefined
    const subQ = meta?.sub_queries as number | undefined
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap gap-1.5">
          <Pill color={rewrote ? 'violet' : 'gray'}>↺ Rewrite {rewrote ? '✓' : '✗'}</Pill>
          <Pill color={hyde ? 'pink' : 'gray'}>HyDE {hyde ? '✓' : '✗'}</Pill>
          {(subQ ?? 0) > 0 && <Pill color="blue">{subQ} sub-queries</Pill>}
        </div>
        {extras?.rewrittenQuery && (
          <div className="bg-gray-800 rounded-lg px-2.5 py-2">
            <div className="text-[9px] text-gray-600 uppercase tracking-wider mb-1">Rewritten query</div>
            <div className="text-[11px] text-gray-200 leading-relaxed">&ldquo;{extras.rewrittenQuery}&rdquo;</div>
          </div>
        )}
        {hyde && !extras?.rewrittenQuery && (
          <p className="text-[10px] text-gray-500">HyDE generated a hypothetical answer document — its embedding replaced the raw query vector for retrieval.</p>
        )}
        <StatGrid items={[{ label: 'Latency', value: ms(timing) }]} />
        {cfg && <ConfigBlock items={[
          { env: 'UTILITY_LLM_PROVIDER', value: cfg.utilityLlmProvider },
          { env: 'UTILITY_LLM_MODEL', value: cfg.utilityLlmModel },
        ]} />}
      </div>
    )
  }

  if (nodeId === 'vector') {
    if (!isActive) return <p className="text-gray-500 text-[11px]">Vector search did not run.</p>
    const count = meta?.result_count as number | undefined
    const topK = extras?.topK ?? 10
    const barPct = count != null ? Math.round((count / topK) * 100) : 0
    return (
      <div className="space-y-2">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold text-white">{count ?? '—'}</span>
          <span className="text-gray-500 text-sm">/ {topK} top_k returned</span>
        </div>
        <div className="space-y-1">
          <div className="flex justify-between text-[9px] text-gray-600">
            <span>results</span><span>{barPct}%</span>
          </div>
          <ScoreBar value={barPct} max={100} />
        </div>
        <StatGrid items={[{ label: 'Latency', value: ms(timing) }, { label: 'Store', value: 'ChromaDB' }]} />
        {cfg && <ConfigBlock items={[
          { env: 'VECTOR_STORE',           value: cfg.vectorStore },
          { env: 'KNOWLEDGE_GAP_THRESHOLD', value: cfg.knowledgeGapThreshold },
        ]} />}
      </div>
    )
  }

  if (nodeId === 'graph') {
    if (!isActive) return <p className="text-gray-500 text-[11px]">Graph disabled — enable <span className="text-emerald-400">Graph</span> toggle to use Neo4j augmentation.</p>
    const count = meta?.entity_count as number | undefined
    return (
      <div className="space-y-2">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold text-white">{count ?? 0}</span>
          <span className="text-gray-500 text-sm">entities found</span>
        </div>
        {(count ?? 0) === 0 && (
          <div className="rounded-lg bg-gray-800 border border-gray-700 px-2.5 py-2 text-[10px] text-gray-500">
            No graph entities matched this query. Check that the namespace has graph data, or try a different query.
          </div>
        )}
        <StatGrid items={[{ label: 'Latency', value: ms(timing) }, { label: 'Store', value: 'Neo4j' }]} />
        {cfg && <ConfigBlock items={[
          { env: 'ENABLE_GRAPH',            value: cfg.enableGraph },
          { env: 'GRAPH_EXTRACTOR_BACKEND', value: cfg.graphExtractorBackend },
          { env: 'GRAPH_LLM_PROVIDER',      value: cfg.graphLlmProvider },
          { env: 'GRAPH_LLM_MODEL',         value: cfg.graphLlmModel },
        ]} />}
      </div>
    )
  }

  if (nodeId === 'rerank') {
    if (!isActive) return <p className="text-gray-500 text-[11px]">Reranking disabled — enable <span className="text-amber-400">Rerank</span> toggle.</p>
    const score = meta?.top_score as number | undefined
    const count = meta?.result_count as number | undefined
    const inCount = vectorMeta?.result_count as number | undefined
    const pct = score != null ? score * 100 : null
    const label = score == null ? '' : score >= 0.9 ? 'EXCELLENT' : score >= 0.7 ? 'GOOD' : score >= 0.5 ? 'FAIR' : 'LOW'
    const labelColor = score == null ? 'text-gray-500' : score >= 0.9 ? 'text-green-400' : score >= 0.7 ? 'text-amber-400' : score >= 0.5 ? 'text-orange-400' : 'text-red-400'
    return (
      <div className="space-y-2">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold text-white">{pct != null ? pct.toFixed(1) : '—'}%</span>
          <span className={`text-xs font-semibold ${labelColor}`}>{label}</span>
        </div>
        <ScoreBar value={score ?? 0} />
        <StatGrid items={[
          { label: 'In → out', value: inCount != null && count != null ? `${inCount} → ${count}` : (count ?? '—') },
          { label: 'Latency', value: ms(timing) },
        ]} />
        {score != null && score < 0.5 && (
          <p className="text-[10px] text-red-400">Low top score — retrieved chunks may not be relevant to this query.</p>
        )}
        {cfg && <ConfigBlock items={[{ env: 'RERANKER_BACKEND', value: cfg.rerankerBackend }]} />}
      </div>
    )
  }

  if (nodeId === 'context') {
    if (!isActive) return <p className="text-gray-500 text-[11px]">Context assembly skipped (retrieve-only mode).</p>
    const chunks = meta?.chunk_count as number | undefined
    const truncated = meta?.truncated as boolean | undefined
    return (
      <div className="space-y-2">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold text-white">{chunks ?? '—'}</span>
          <span className="text-gray-500 text-sm">chunks assembled</span>
          {truncated && <Pill color="amber">⚠ truncated</Pill>}
        </div>
        <StatGrid items={[{ label: 'Latency', value: ms(timing) }]} />
        {truncated && <p className="text-[10px] text-amber-400">Context was truncated to fit the LLM token budget.</p>}
        {cfg && <ConfigBlock items={[
          { env: 'COMPRESSOR',                    value: cfg.compressor },
          { env: 'CONTEXT_DEDUP_OVERLAP_THRESHOLD', value: cfg.contextDedupOverlapThreshold },
          { env: 'CONTEXT_COMPRESSION_THRESHOLD',   value: cfg.contextCompressionThreshold },
        ]} />}
      </div>
    )
  }

  if (nodeId === 'llm') {
    if (!isActive) return <p className="text-gray-500 text-[11px]">LLM not called — use Generate mode to produce an answer.</p>
    const ansLen = meta?.answer_len as number | undefined
    const tools = meta?.from_tools as unknown[] | undefined
    return (
      <div className="space-y-2">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold text-white">{ansLen ?? '—'}</span>
          <span className="text-gray-500 text-sm">chars generated</span>
        </div>
        <StatGrid items={[
          { label: 'Latency', value: ms(timing) },
          { label: 'ReAct calls', value: tools?.length ?? 0 },
        ]} />
        {tools && tools.length > 0 && <p className="text-[10px] text-blue-400">LLM made {tools.length} tool call{tools.length !== 1 ? 's' : ''} (ReAct loop).</p>}
        {cfg && <ConfigBlock items={[
          { env: 'GENERATION_LLM_PROVIDER', value: cfg.generationLlmProvider },
          { env: 'GENERATION_LLM_MODEL', value: cfg.generationLlmModel },
        ]} />}
      </div>
    )
  }

  if (nodeId === 'chunks') {
    const rerank = vectorMeta  // rerank result_count is in rerank meta — use that if available
    const count = meta?.result_count as number | undefined ?? rerank?.result_count as number | undefined
    return isActive ? (
      <div className="space-y-2">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold text-white">{count ?? '—'}</span>
          <span className="text-gray-500 text-sm">chunks output</span>
        </div>
        <p className="text-[10px] text-gray-600">Scroll the sidebar → to see full chunk content and scores.</p>
        {cfg && <ConfigBlock items={[{ env: 'KNOWLEDGE_GAP_THRESHOLD', value: cfg.knowledgeGapThreshold }]} />}
      </div>
    ) : <p className="text-gray-500 text-[11px]">No chunks returned.</p>
  }

  return null
}

// ─── SVG Helpers ─────────────────────────────────────────────────────────────

function PipelineDiagram({ pipeline, systemConfig }: { pipeline: PipelineData; systemConfig: SystemConfig | null }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const nm = Object.fromEntries(PIPELINE_NODES.map(n => [n.id, n]))
  const { status, mode, activeNodes, nodeTimings, nodeMeta } = pipeline

  const nodeActive = (n: PNode): boolean => {
    if (status === 'idle') return false
    if (status === 'loading') {
      // context/llm show as "pending" (waiting for LLM), not "active"
      if (mode === 'full' && (n.id === 'context' || n.id === 'llm')) return false
      return n.group !== 'full' || mode === 'full'
    }
    return activeNodes.has(n.id)
  }

  const nodePending = (n: PNode): boolean =>
    status === 'loading' && mode === 'full' && (n.id === 'context' || n.id === 'llm')

  const edgeActive = (a: string, b: string, t: EdgeType): boolean => {
    if (status !== 'done') return false
    if (t === 'retrieve') {
      // query→vector is a bypass shortcut — only show when qintel didn't run
      if (a === 'query') return activeNodes.has('vector') && !activeNodes.has('qintel')
      // vector→rerank, rerank→chunks — always show when both endpoints fired
      return activeNodes.has(a) && activeNodes.has(b)
    }
    if (t === 'retrieve-graph') {
      // query→graph is a bypass shortcut — only show when qintel didn't run
      if (a === 'query') return activeNodes.has('graph') && !activeNodes.has('qintel')
      // graph→rerank — always show when both endpoints fired
      return activeNodes.has(a) && activeNodes.has(b)
    }
    // Full path edges — show when both endpoints fired
    return activeNodes.has(a) && activeNodes.has(b)
  }

  const nodeTooltip = (n: PNode): string => {
    const ms = nodeTimings.get(n.id)
    const meta = nodeMeta.get(n.id)
    const parts: string[] = [n.label]
    if (ms) parts.push(`${ms.toFixed(0)}ms`)
    if (meta?.hit !== undefined) parts.push(meta.hit ? '✓ CACHE HIT' : '✗ miss')
    if (meta?.result_count !== undefined) parts.push(`${meta.result_count} results`)
    if (meta?.entity_count !== undefined) parts.push(`${meta.entity_count} entities`)
    if (meta?.top_score !== undefined) parts.push(`score: ${(meta.top_score as number).toFixed(3)}`)
    if (meta?.entry_count !== undefined) parts.push(`${meta.entry_count} entries`)
    if (meta?.rewritten) parts.push('rewritten ✓')
    if (meta?.hyde) parts.push('HyDE ✓')
    return parts.join(' · ')
  }

  const bez = (a: string, b: string) => {
    const na = nm[a], nb = nm[b]
    if (!na || !nb) return ''
    const x1 = na.x + na.w, y1 = na.y + na.h / 2
    const x2 = nb.x,         y2 = nb.y + nb.h / 2
    const mx = (x1 + x2) / 2
    return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`
  }

  const VW = 762, VH = 228

  return (
    <div>
      {/* Aspect-ratio wrapper so %-based popup positions align with SVG coords */}
      <div className="relative w-full" style={{ aspectRatio: `${VW}/${VH}` }}>
      <svg viewBox={`0 0 ${VW} ${VH}`} className="absolute inset-0 w-full h-full" preserveAspectRatio="xMidYMid meet">
        <defs>
          <filter id="pg-glow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="3.5" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <marker id="arr-on"  markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto">
            <path d="M0,0 L5,2.5 L0,5 Z" fill="#f59e0b" />
          </marker>
          <marker id="arr-full" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto">
            <path d="M0,0 L5,2.5 L0,5 Z" fill="#22c55e" />
          </marker>
          <marker id="arr-off" markerWidth="4" markerHeight="4" refX="3" refY="2" orient="auto">
            <path d="M0,0 L4,2 L0,4 Z" fill="#1f2937" />
          </marker>
        </defs>

        {/* Section backgrounds */}
        <rect x={92}  y={24} width={104} height={180} rx={4} fill="#0f172a" opacity={0.6} />
        <rect x={208} y={24} width={108} height={180} rx={4} fill="#0f172a" opacity={0.4} />
        <rect x={324} y={24} width={108} height={180} rx={4} fill="#0f172a" opacity={0.2} />
        <rect x={548} y={24} width={104} height={180} rx={4} fill="#0f172a" opacity={0.4} />

        {/* Section labels */}
        {[
          { label: 'USER CONTEXT', x: 144 },
          { label: 'Q. ENHANCE',   x: 262 },
          { label: 'RETRIEVAL',    x: 378 },
          { label: 'GENERATION',   x: 600 },
        ].map(s => (
          <text key={s.label} x={s.x} y={19} textAnchor="middle"
            fill="#374151" fontSize={7.5} fontWeight={700} letterSpacing={0.8}>
            {s.label}
          </text>
        ))}

        {/* All edges — full-query path first (dim/dashed) */}
        {PIPELINE_EDGES.map(([a, b, type], i) => {
          const p = bez(a, b); if (!p) return null
          const on = edgeActive(a, b, type)
          const loading = status === 'loading'
          const isFullEdge = type === 'full'
          const color = on
            ? (isFullEdge ? '#22c55e' : '#f59e0b')
            : (loading && !isFullEdge ? '#3b82f6' : '#1e293b')
          const width = on ? 2.5 : loading && !isFullEdge ? 1.5 : 1
          const dash = !on && (isFullEdge || (!loading)) ? '4 3' : undefined
          const marker = on ? (isFullEdge ? 'url(#arr-full)' : 'url(#arr-on)') : 'url(#arr-off)'
          return (
            <g key={`e${i}`}>
              <path d={p} fill="none" stroke={color} strokeWidth={width}
                strokeDasharray={dash} markerEnd={marker} />
              {on && <circle r={4.5} fill={isFullEdge ? '#86efac' : '#fbbf24'} opacity={0.95}>
                <animateMotion dur={`${0.85 + i * 0.1}s`} repeatCount="indefinite" path={p} />
              </circle>}
              {loading && !isFullEdge && <circle r={3} fill="#60a5fa" opacity={0.75}>
                <animateMotion dur={`${1.2 + i * 0.15}s`} repeatCount="indefinite" path={p} />
              </circle>}
            </g>
          )
        })}

        {/* Nodes */}
        {PIPELINE_NODES.map(node => {
          const on = nodeActive(node)
          const pending = nodePending(node)
          const hasTime = nodeTimings.has(node.id)
          const isFullNode = node.group === 'full'
          const isSelected = selectedId === node.id
          // dim non-active full nodes; in retrieve mode, full nodes are always dim unless active
          const op = !on && !pending && isFullNode && status === 'done' ? 0.35 : 1
          return (
            <g key={node.id} transform={`translate(${node.x},${node.y})`} opacity={op}
              onClick={() => setSelectedId(isSelected ? null : node.id)}
              style={{ cursor: 'pointer' }}>
              <title>{pending ? `${node.label} · waiting for pipeline…` : nodeTooltip(node)}</title>
              <rect width={node.w} height={node.h} rx={5}
                fill={on ? node.color : '#0f172a'}
                stroke={on ? node.color : (isFullNode ? '#1e3a5f' : '#1e293b')}
                strokeWidth={on ? 2 : 1}
                strokeDasharray={isFullNode && !on && !pending ? '3 2' : undefined}
                filter={on ? 'url(#pg-glow)' : undefined}
              />
              {/* Pending pulse overlay for context/llm waiting for LLM */}
              {pending && (
                <rect width={node.w} height={node.h} rx={5} fill="none"
                  stroke="#a78bfa" strokeWidth={1.5} strokeDasharray="4 2">
                  <animate attributeName="stroke-opacity" values="0.2;1;0.2" dur="1.4s" repeatCount="indefinite" />
                  <animate attributeName="stroke-dashoffset" values="0;-12" dur="0.9s" repeatCount="indefinite" />
                </rect>
              )}
              {/* Selected ring */}
              {isSelected && (
                <rect x={-2} y={-2} width={node.w + 4} height={node.h + 4} rx={7}
                  fill="none" stroke="white" strokeWidth={1.5} opacity={0.6} />
              )}
              {/* Icon — left edge, vertically centred on main text */}
              <text x={6} y={node.sublabel ? 11 : 15}
                textAnchor="start"
                fill={on ? 'rgba(255,255,255,0.75)' : pending ? '#7c6bb0' : (isFullNode ? '#1e3a5f' : '#2d3748')}
                fontSize={8}>
                {node.icon}
              </text>
              <text x={node.w / 2 + 4} y={node.sublabel ? 10 : 15}
                textAnchor="middle" fill={on ? 'white' : pending ? '#a78bfa' : '#4b5563'}
                fontSize={9} fontWeight={on || pending ? 700 : 400}>
                {node.label}
              </text>
              {node.sublabel && (
                <text x={node.w / 2 + 4} y={21} textAnchor="middle"
                  fill={on ? 'rgba(255,255,255,0.55)' : pending ? 'rgba(167,139,250,0.5)' : '#1e3a5f'} fontSize={7}>
                  {node.sublabel}
                </text>
              )}
              {/* Timing badge */}
              {on && hasTime && (
                <text x={node.w} y={0} textAnchor="end"
                  fill="#fbbf24" fontSize={6.5} opacity={0.85}>
                  {nodeTimings.get(node.id)!.toFixed(0)}ms
                </text>
              )}
              {/* Pending "…" indicator */}
              {pending && (
                <text x={node.w} y={0} textAnchor="end" fill="#a78bfa" fontSize={6.5}>
                  <animate attributeName="opacity" values="0;1;0" dur="1.4s" repeatCount="indefinite" />
                  waiting…
                </text>
              )}
            </g>
          )
        })}

        {/* Status text */}
        {status === 'loading' && (
          <text x={VW / 2} y={VH - 2} textAnchor="middle" fill="#60a5fa" fontSize={8}>
            {mode === 'full' ? 'running generative pipeline — LLM generating answer (~30–60s)…' : 'retrieving…'}
          </text>
        )}
        {status === 'done' && pipeline.cacheHit && (
          <text x={VW / 2} y={VH - 2} textAnchor="middle" fill="#a78bfa" fontSize={8}>
            ✓ semantic cache hit — downstream stages skipped
          </text>
        )}
        {status === 'done' && !pipeline.cacheHit && mode === 'retrieve' && (
          <text x={VW / 2} y={VH - 2} textAnchor="middle" fill="#d97706" fontSize={8}>
            inspect-only · Cache + Memory + Q.Intel + LLM not called (use Generate mode for those)
          </text>
        )}
        {status === 'done' && !pipeline.cacheHit && mode === 'full' && (
          <text x={VW / 2} y={VH - 2} textAnchor="middle" fill="#22c55e" fontSize={8}>
            ✓ generative pipeline complete — hover nodes for timing details
          </text>
        )}
      </svg>

      {/* Click-away backdrop */}
      {selectedId && (
        <div className="absolute inset-0 z-10" onClick={() => setSelectedId(null)} />
      )}

      {/* Floating popup — positioned near the clicked node */}
      {selectedId && (() => {
        const node = nm[selectedId]
        if (!node) return null
        const on = activeNodes.has(selectedId)
        const pending = status === 'loading' && mode === 'full' && (selectedId === 'context' || selectedId === 'llm')
        const timing = nodeTimings.get(selectedId)
        const meta = nodeMeta.get(selectedId)
        const vectorMeta = selectedId === 'chunks' ? nodeMeta.get('rerank') ?? nodeMeta.get('vector') : undefined
        const nodeCenterX = node.x + node.w / 2
        const leftPct = (nodeCenterX / VW) * 100
        // Horizontal alignment: avoid overflowing left or right edge
        const xAlign: React.CSSProperties =
          nodeCenterX < VW * 0.35
            ? { left: `${leftPct}%`, transform: 'translateX(0)' }          // left zone → popup goes right
            : nodeCenterX > VW * 0.65
            ? { left: `${leftPct}%`, transform: 'translateX(-100%)' }       // right zone → popup goes left
            : { left: `${leftPct}%`, transform: 'translateX(-50%)' }        // center → centered
        const showBelow = node.y < VH * 0.55
        const yAlign: React.CSSProperties = showBelow
          ? { top: `${((node.y + node.h + 6) / VH) * 100}%` }
          : { bottom: `${((VH - node.y + 6) / VH) * 100}%` }
        return (
          <div
            className="absolute z-20 w-64 rounded-xl border shadow-2xl p-3 text-xs"
            style={{
              background: '#0c0c12',
              borderColor: '#2d2d3d',
              boxShadow: '0 8px 32px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04)',
              ...xAlign,
              ...yAlign,
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center gap-1.5 mb-1.5 pb-1.5 border-b border-gray-800">
              <span style={{ color: node.color }} className="text-sm leading-none">{node.icon}</span>
              <span className="font-semibold text-white text-[12px]">{node.label}</span>
              <div className="ml-auto flex items-center gap-1.5">
                {pending && <span className="text-violet-400 text-[9px] animate-pulse">waiting…</span>}
                {!pending && on && <span className="text-[9px] text-green-500">✓ fired</span>}
                {!pending && !on && status === 'done' && <span className="text-[9px] text-gray-600">skipped</span>}
                <button onClick={() => setSelectedId(null)} className="ml-0.5 text-gray-600 hover:text-gray-300 text-base leading-none">×</button>
              </div>
            </div>
            {/* Per-node body */}
            <div className="mb-2">
              {renderNodeBody(selectedId, meta, timing, on, pending, pipeline.extras, status, vectorMeta, systemConfig ?? null)}
            </div>
            {/* Purpose footer */}
            <div className="pt-1.5 border-t border-gray-800">
              <p className="text-[9px] text-gray-600">{NODE_PURPOSE[selectedId]}</p>
            </div>
          </div>
        )
      })()}

      </div>{/* end aspect-ratio wrapper */}

      {/* Legend */}
      <div className="flex items-center gap-5 mt-1 text-[10px] text-gray-600">
        <span className="flex items-center gap-1.5">
          <span className="w-5 h-0.5 bg-yellow-500 inline-block rounded" />
          inspect path
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-5 h-0.5 bg-green-500 inline-block rounded" />
          generative pipeline
        </span>
        <span className="flex items-center gap-1.5">
          <svg width={20} height={6}><line x1={0} y1={3} x2={20} y2={3} stroke="#334155" strokeDasharray="4 2" strokeWidth={1} /></svg>
          not called
        </span>
        <span className="text-gray-700 ml-1">click node for details</span>
        {status === 'done' && (
          <span className={`ml-auto font-medium ${pipeline.cacheHit ? 'text-violet-400' : mode === 'full' ? 'text-green-400' : 'text-yellow-400'}`}>
            ● {pipeline.cacheHit ? 'cache hit' : mode === 'full' ? 'generative pipeline' : `${activeNodes.size} stages fired`}
          </span>
        )}
      </div>
    </div>
  )
}

function ExpandableText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  const isLong = text.length > 320
  return (
    <div>
      <p className={`text-xs text-gray-300 leading-relaxed whitespace-pre-wrap ${!expanded && isLong ? 'line-clamp-6' : ''}`}>
        {text}
      </p>
      {isLong && (
        <button onClick={() => setExpanded(v => !v)}
          className="mt-1.5 text-[10px] text-gray-600 hover:text-gray-300 transition-colors">
          {expanded ? '▲ show less' : '▼ show more'}
        </button>
      )}
    </div>
  )
}

function ChunkScoreBar({ score, max = 1 }: { score: number; max?: number }) {
  const pct = Math.min((score / max) * 100, 100)
  const color = pct > 70 ? '#22c55e' : pct > 40 ? '#f59e0b' : '#ef4444'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden">
        <div style={{ width: `${pct}%`, background: color }} className="h-full rounded-full transition-all" />
      </div>
      <span className="text-xs font-mono text-gray-300 w-10 text-right">{score.toFixed(3)}</span>
    </div>
  )
}

function ChunkBlock({ chunk, active, onClick }: {
  chunk: Chunk; active: boolean; onClick: () => void
}) {
  const w = Math.max(40, Math.min(120, chunk.char_count / 10))
  return (
    <button
      onClick={onClick}
      title={`Chunk ${chunk.sequence_index} — ${chunk.char_count} chars`}
      className={`rounded border text-[9px] font-mono transition-all ${
        active ? 'border-purple-500 bg-purple-600/30 text-purple-300'
               : 'border-gray-700 bg-gray-800 text-gray-500 hover:border-gray-500'
      }`}
      style={{ width: w, height: 36, minWidth: 32, flexShrink: 0 }}
    >
      {chunk.sequence_index}
    </button>
  )
}

// ─── Interactive Graph Canvas ─────────────────────────────────────────────────

const TYPE_COLOR: Record<string, string> = {
  PERSON: '#7c3aed', ORG: '#2563eb', ORGANIZATION: '#2563eb',
  CONCEPT: '#0891b2', LOCATION: '#059669', LOC: '#059669', GPE: '#059669',
  DATE: '#d97706', TIME: '#d97706', EVENT: '#dc2626', PRODUCT: '#0f766e',
}

function GraphCanvasWrapper({ entities, relations }: { entities: GraphEntity[]; relations: GraphRelation[] }) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  useEffect(() => {
    const el = wrapperRef.current; if (!el) return
    const measure = () => setSize({ w: el.offsetWidth, h: el.offsetHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div ref={wrapperRef} className="relative flex-1 min-h-0 bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      {size.w > 0 && size.h > 0 && (
        <GraphCanvas entities={entities} relations={relations} width={size.w} height={size.h} />
      )}
    </div>
  )
}

function GraphCanvas({ entities, relations, width, height }: {
  entities: GraphEntity[]; relations: GraphRelation[]; width: number; height: number
}) {
  const [selected, setSelected] = useState<GraphEntity | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [FG, setFG] = useState<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [SpriteText, setSpriteText] = useState<(new (text: string) => any) | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(null)

  useEffect(() => {
    import('react-force-graph-3d').then(m => setFG(() => m.default ?? m))
    import('three-spritetext').then(m => setSpriteText(() => m.default))
  }, [])

  useEffect(() => { setSelected(null) }, [entities])

  const graphData = useMemo(() => ({
    nodes: entities.map(e => ({
      id: e.name,
      name: e.name,
      entityType: e.type,
      color: TYPE_COLOR[e.type] ?? '#6b7280',
    })),
    links: relations
      .filter(r => r.source && r.target)
      .map(r => ({
        source: r.source,
        target: r.target,
        label: r.relation_type,
      })),
  }), [entities, relations])

  if (!entities.length) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-gray-600 text-sm">
        <svg width={48} height={48} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1}>
          <circle cx="5" cy="12" r="2.5" /><circle cx="19" cy="5" r="2.5" /><circle cx="19" cy="19" r="2.5" />
          <path d="M7 12h5m2-5.5-4.5 5m4.5 0-4.5 5" strokeLinecap="round" />
        </svg>
        <p>No entities — run a graph query or click <span className="text-emerald-400">Mock Data</span></p>
      </div>
    )
  }

  const visibleTypes = Array.from(new Set(entities.map(e => e.type))).filter(t => TYPE_COLOR[t])

  if (!FG) return (
    <div className="absolute inset-0 flex items-center justify-center text-gray-600 text-xs">
      Loading 3D engine…
    </div>
  )

  return (
    <div className="absolute inset-0">
      <FG
        ref={fgRef}
        key={entities.map(e => e.name).join('|')}
        graphData={graphData}
        width={width}
        height={height}
        backgroundColor="#111827"
        nodeColor={(node: Record<string, unknown>) => (node.color as string) ?? '#6b7280'}
        nodeRelSize={5}
        nodeThreeObject={SpriteText ? (node: Record<string, unknown>) => {
          const sprite = new SpriteText!(node.name as string)
          sprite.color = '#ffffff'
          sprite.textHeight = 5
          sprite.fontWeight = 'bold'
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(sprite as any).material.depthTest = false
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(sprite as any).renderOrder = 999
          sprite.position.y = 9
          return sprite
        } : undefined}
        nodeThreeObjectExtend={!!SpriteText}
        linkLabel={(link: Record<string, unknown>) => link.label as string}
        linkColor={() => '#4b5563'}
        linkWidth={1.5}
        linkDirectionalArrowLength={4}
        linkDirectionalArrowRelPos={1}
        cooldownTicks={120}
        onEngineStop={() => {
          if (fgRef.current?.zoomToFit) {
            fgRef.current.zoomToFit(800, 20)
          }
        }}
        onNodeClick={(node: Record<string, unknown>) => {
          const e = entities.find(en => en.name === (node.id as string))
          setSelected(prev => prev?.name === (node.id as string) ? null : (e ?? null))
        }}
      />

      {selected && (
        <div className="absolute bottom-6 right-2 bg-gray-900/95 border border-gray-700 rounded-xl px-3 py-2.5 text-xs max-w-[180px] z-10">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ background: TYPE_COLOR[selected.type] ?? '#6b7280' }} />
            <span className="text-white font-semibold truncate">{selected.name}</span>
          </div>
          <div className="text-gray-500">{selected.type}</div>
          <div className="text-gray-600 mt-1">
            {relations.filter(r => r.source === selected.name || r.target === selected.name).length} relations
          </div>
          <div className="flex flex-wrap gap-1 mt-1.5">
            {relations
              .filter(r => r.source === selected.name || r.target === selected.name)
              .slice(0, 4)
              .map((r, i) => (
                <span key={i} className="text-[9px] bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded">
                  {r.relation_type}
                </span>
              ))}
          </div>
          <button onClick={() => setSelected(null)}
            className="mt-2 text-[9px] text-gray-600 hover:text-gray-400">✕ close</button>
        </div>
      )}

      <div className="absolute bottom-2 left-2 text-[9px] text-gray-700 pointer-events-none">
        Left-drag to rotate · Right-drag to pan · Scroll to zoom · Click node to inspect
      </div>

      {visibleTypes.length > 0 && (
        <div className="absolute top-2 left-2 flex flex-wrap gap-1.5 max-w-[200px]">
          {visibleTypes.map(t => (
            <span key={t} className="flex items-center gap-1 text-[8px] text-gray-500">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: TYPE_COLOR[t] }} />
              {t}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Memory Timeline ──────────────────────────────────────────────────────────

function MemoryTimeline({ entries }: { entries: MemoryEntry[] }) {
  if (!entries.length) return (
    <div className="text-gray-600 text-sm text-center py-8">No memory entries</div>
  )
  const sorted = [...entries].sort((a, b) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )
  return (
    <div className="relative pl-8">
      {/* Vertical line */}
      <div className="absolute left-3 top-0 bottom-0 w-px bg-gray-700" />
      {sorted.map((e, i) => {
        const src = e.source === 'short' ? '⚡' : '🗄'
        const d = new Date(e.created_at)
        return (
          <div key={e.id} className="relative mb-4">
            <div className="absolute -left-5 w-3 h-3 rounded-full bg-purple-500 border-2 border-gray-900 top-1.5" />
            <div className="bg-gray-800 border border-gray-700 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] text-purple-400 font-mono">{src}</span>
                <span className="text-[10px] text-gray-500">{d.toLocaleString()}</span>
                {e.source && (
                  <span className="text-[9px] bg-gray-700 text-gray-400 px-1.5 py-0.5 rounded">
                    {e.source}
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-300 line-clamp-3">{e.content}</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Cache Bars ───────────────────────────────────────────────────────────────

function CacheList({ entries }: { entries: CacheEntry[] }) {
  if (!entries.length) return (
    <div className="text-gray-600 text-sm text-center py-8">No cache entries</div>
  )
  const maxTtl = Math.max(...entries.map(e => e.ttl_seconds), 1)
  return (
    <div className="space-y-2">
      {entries.map((e, i) => (
        <div key={e.key} className="bg-gray-800 border border-gray-700 rounded-lg p-3">
          <div className="flex items-start justify-between gap-2 mb-2">
            <span className="text-xs text-gray-300 font-medium flex-1 truncate">
              {e.query_text || e.key}
            </span>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[10px] bg-purple-600/30 text-purple-300 px-1.5 py-0.5 rounded font-mono">
                {e.citations_count} cit
              </span>
              <span className="text-[10px] text-gray-500 font-mono">{e.namespace}</span>
            </div>
          </div>
          {/* TTL bar */}
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-gray-600 w-8">TTL</span>
            <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${(e.ttl_seconds / maxTtl) * 100}%` }}
              />
            </div>
            <span className="text-[9px] font-mono text-gray-500 w-14 text-right">
              {e.ttl_seconds > 0 ? `${Math.round(e.ttl_seconds / 60)}m` : 'expired'}
            </span>
          </div>
          {e.answer_snippet && (
            <p className="text-[10px] text-gray-500 mt-1.5 line-clamp-2">{e.answer_snippet}</p>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Mock Data ────────────────────────────────────────────────────────────────

const MOCK_RESULT_WITH_GRAPH: RetrieveResult = {
  query: 'What is machine learning and how does it relate to neural networks?',
  retrieval_latency_ms: 312,
  total_chunks_before_rerank: 8,
  graph_entities: [
    { name: 'Machine Learning', type: 'CONCEPT' },
    { name: 'Neural Network', type: 'CONCEPT' },
    { name: 'Deep Learning', type: 'CONCEPT' },
    { name: 'Geoffrey Hinton', type: 'PERSON' },
    { name: 'Google Brain', type: 'ORG' },
    { name: 'ImageNet', type: 'PRODUCT' },
    { name: 'Backpropagation', type: 'CONCEPT' },
  ],
  chunks: [
    {
      chunk_id: 'mock-c1',
      document_id: 'mock-doc-1',
      filename: 'machine-learning-overview.pdf',
      text_snippet: 'Machine learning (ML) is a subfield of artificial intelligence that gives computers the ability to learn from data without being explicitly programmed. It involves algorithms that improve automatically through experience.',
      score: 0.924,
      sequence_index: 0,
      stage: 'reranked',
    },
    {
      chunk_id: 'mock-c2',
      document_id: 'mock-doc-1',
      filename: 'machine-learning-overview.pdf',
      text_snippet: 'Neural networks are computing systems inspired by biological neural networks. They consist of layers of interconnected nodes (neurons) that process information using connectionist approaches.',
      score: 0.871,
      sequence_index: 1,
      stage: 'reranked',
    },
    {
      chunk_id: 'mock-c3',
      document_id: 'mock-doc-2',
      filename: 'deep-learning-fundamentals.txt',
      text_snippet: 'Deep learning is a subset of machine learning based on artificial neural networks with many hidden layers. Geoffrey Hinton at Google Brain pioneered many breakthrough techniques including backpropagation.',
      score: 0.803,
      sequence_index: 0,
      stage: 'reranked',
    },
    {
      chunk_id: 'mock-c4',
      document_id: 'mock-doc-3',
      filename: 'imagenet-paper.pdf',
      text_snippet: 'ImageNet Large Scale Visual Recognition Challenge (ILSVRC) dramatically accelerated deep learning research. AlexNet in 2012 demonstrated that deep convolutional neural networks could achieve superhuman performance.',
      score: 0.756,
      sequence_index: 2,
      stage: 'reranked',
    },
    {
      chunk_id: 'mock-c5',
      document_id: 'mock-doc-2',
      filename: 'deep-learning-fundamentals.txt',
      text_snippet: 'Backpropagation is the core algorithm for training neural networks. It computes gradients of the loss function with respect to network weights using the chain rule of calculus.',
      score: 0.712,
      sequence_index: 3,
      stage: 'reranked',
    },
  ],
}

const MOCK_RESULT_NO_GRAPH: RetrieveResult = {
  query: 'How does Redis semantic caching work?',
  retrieval_latency_ms: 89,
  total_chunks_before_rerank: 5,
  graph_entities: [],
  chunks: [
    {
      chunk_id: 'mock-r1',
      document_id: 'mock-doc-4',
      filename: 'rag-architecture.md',
      text_snippet: 'Semantic caching stores query-response pairs indexed by embedding vectors. When a new query arrives, the system checks for semantically similar cached queries within a configurable similarity threshold.',
      score: 0.951,
      sequence_index: 0,
      stage: 'reranked',
    },
    {
      chunk_id: 'mock-r2',
      document_id: 'mock-doc-4',
      filename: 'rag-architecture.md',
      text_snippet: 'Redis is used as the primary cache backend. Cache keys are derived from the embedding vector. TTL (time-to-live) is configurable per namespace to ensure freshness of responses.',
      score: 0.887,
      sequence_index: 1,
      stage: 'reranked',
    },
    {
      chunk_id: 'mock-r3',
      document_id: 'mock-doc-5',
      filename: 'performance-guide.txt',
      text_snippet: 'Cache hit rates above 30% significantly reduce LLM costs. The semantic cache threshold should be tuned based on query diversity — lower for precise domains, higher for general conversation.',
      score: 0.734,
      sequence_index: 0,
      stage: 'reranked',
    },
  ],
}

const MOCK_GRAPH_ENTITIES: GraphEntity[] = [
  { name: 'Machine Learning', type: 'CONCEPT' },
  { name: 'Neural Network', type: 'CONCEPT' },
  { name: 'Deep Learning', type: 'CONCEPT' },
  { name: 'Geoffrey Hinton', type: 'PERSON' },
  { name: 'Yann LeCun', type: 'PERSON' },
  { name: 'Google Brain', type: 'ORG' },
  { name: 'Meta AI', type: 'ORG' },
  { name: 'ImageNet', type: 'PRODUCT' },
  { name: 'Backpropagation', type: 'CONCEPT' },
  { name: 'GPT-4', type: 'PRODUCT' },
  { name: '2012', type: 'DATE' },
  { name: 'AlexNet', type: 'EVENT' },
]

const MOCK_GRAPH_RELATIONS: GraphRelation[] = [
  { source: 'Deep Learning', target: 'Machine Learning', relation_type: 'IS_SUBSET_OF' },
  { source: 'Neural Network', target: 'Machine Learning', relation_type: 'USED_IN' },
  { source: 'Deep Learning', target: 'Neural Network', relation_type: 'BASED_ON' },
  { source: 'Geoffrey Hinton', target: 'Google Brain', relation_type: 'WORKS_AT' },
  { source: 'Geoffrey Hinton', target: 'Backpropagation', relation_type: 'INVENTED' },
  { source: 'Yann LeCun', target: 'Meta AI', relation_type: 'WORKS_AT' },
  { source: 'Yann LeCun', target: 'Neural Network', relation_type: 'RESEARCHES' },
  { source: 'AlexNet', target: 'ImageNet', relation_type: 'WON' },
  { source: 'AlexNet', target: '2012', relation_type: 'OCCURRED_IN' },
  { source: 'AlexNet', target: 'Deep Learning', relation_type: 'ACCELERATED' },
  { source: 'GPT-4', target: 'Deep Learning', relation_type: 'USES' },
  { source: 'Backpropagation', target: 'Neural Network', relation_type: 'TRAINS' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildNsPayload(raw: string): Record<string, unknown> {
  const list = raw.split(',').map((s) => s.trim()).filter(Boolean)
  if (list.length > 1) return { namespaces: list }
  if (list.length === 1) return { namespace: list[0] }
  return { namespace: 'default' }
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function KnowledgePreviewUI() {
  const [activeTab, setActiveTab] = useState('retrieval')
  const [systemConfig, setSystemConfig] = useState<SystemConfig | null>(null)

  useEffect(() => {
    fetch('/api/system-config').then(r => r.json()).then(setSystemConfig).catch(() => {})
  }, [])

  // Retrieval tab
  const [retrieveQuery, setRetrieveQuery] = useState('')
  const [retrieveNs, setRetrieveNs] = useState('default')
  const [retrieveUserId, setRetrieveUserId] = useState('')
  const [retrieveTopK, setRetrieveTopK] = useState(10)
  const [retrieveTopN, setRetrieveTopN] = useState(5)
  const [retrieveUseGraph, setRetrieveUseGraph] = useState(true)
  const [retrieveUseRerank, setRetrieveUseRerank] = useState(true)
  const [retrieveUseCache, setRetrieveUseCache] = useState(false)
  const [retrieveUseMemory, setRetrieveUseMemory] = useState(false)
  const [retrieveUseRewrite, setRetrieveUseRewrite] = useState(false)
  const [retrieveUseHyde, setRetrieveUseHyde] = useState(false)
  const [pipelineMode, setPipelineMode] = useState<'retrieve' | 'full'>('retrieve')
  const [retrieveResult, setRetrieveResult] = useState<RetrieveResult | null>(null)
  const [fullQueryResult, setFullQueryResult] = useState<FullQueryResult | null>(null)
  const [retrieveLoading, setRetrieveLoading] = useState(false)
  const [fullQueryLoading, setFullQueryLoading] = useState(false)
  const [retrieveError, setRetrieveError] = useState<string | null>(null)
  const [pipeline, setPipeline] = useState<PipelineData>(EMPTY_PIPELINE)

  // Documents tab
  const [documents, setDocuments] = useState<Document[]>([])
  const [docsNs, setDocsNs] = useState('default')
  const [docsLoading, setDocsLoading] = useState(false)

  // Chunks tab
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null)
  const [chunks, setChunks] = useState<Chunk[]>([])
  const [activeChunk, setActiveChunk] = useState<number>(0)
  const [chunksLoading, setChunksLoading] = useState(false)

  // Graph tab
  const [graphQuery, setGraphQuery] = useState('')
  const [graphNs, setGraphNs] = useState('default')
  const [graphEntities, setGraphEntities] = useState<GraphEntity[]>([])
  const [graphRelations, setGraphRelations] = useState<GraphRelation[]>([])
  const [graphLoading, setGraphLoading] = useState(false)
  const [graphError, setGraphError] = useState<string | null>(null)

  // Memory tab
  const [memoryUsers, setMemoryUsers] = useState<MemoryUser[]>([])
  const [selectedUser, setSelectedUser] = useState<string>('')
  const [memoryEntries, setMemoryEntries] = useState<MemoryEntry[]>([])
  const [memoryLoading, setMemoryLoading] = useState(false)

  // Cache tab
  const [cacheEntries, setCacheEntries] = useState<CacheEntry[]>([])
  const [cacheNs, setCacheNs] = useState('')
  const [cacheLoading, setCacheLoading] = useState(false)

  // ── Mock ──
  const loadMock = (withGraph: boolean) => {
    const mock = withGraph ? MOCK_RESULT_WITH_GRAPH : MOCK_RESULT_NO_GRAPH
    setRetrieveQuery(mock.query)
    setRetrieveResult(mock)
    setFullQueryResult(null)
    setRetrieveError(null)
    // Synthesize mock stage data
    const mockStages: StageTimingInfo[] = [
      { stage: 'embed', fired: true, latency_ms: 12.3 },
      { stage: 'vector', fired: true, latency_ms: 45.1, meta: { result_count: mock.total_chunks_before_rerank } },
      ...(withGraph ? [{ stage: 'graph', fired: true, latency_ms: 38.7, meta: { entity_count: mock.graph_entities.length } }] : []),
      { stage: 'rerank', fired: true, latency_ms: 28.4, meta: { result_count: mock.chunks.length, top_score: mock.chunks[0]?.score ?? 0 } },
    ]
    setPipeline(buildPipelineData(mockStages, 'retrieve', false))
  }

  const loadGraphMock = () => {
    setGraphEntities(MOCK_GRAPH_ENTITIES)
    setGraphRelations(MOCK_GRAPH_RELATIONS)
    setGraphError(null)
    setGraphQuery('machine learning neural networks')
  }

  // ── Retrieval ──
  const runRetrieve = async () => {
    if (!retrieveQuery.trim()) return
    setRetrieveLoading(true)
    setRetrieveError(null)
    setRetrieveResult(null)
    setFullQueryResult(null)
    setPipeline({ ...EMPTY_PIPELINE, status: 'loading', mode: 'retrieve' })
    try {
      const res = await fetch('/api/retrieve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: retrieveQuery,
          ...buildNsPayload(retrieveNs),
          top_k: retrieveTopK,
          top_n_rerank: retrieveTopN,
          use_graph: retrieveUseGraph,
          use_rerank: retrieveUseRerank,
          use_cache: retrieveUseCache,
          use_memory: retrieveUseMemory,
          use_rewrite: retrieveUseRewrite,
          use_hyde: retrieveUseHyde,
          ...(retrieveUserId ? { user_id: retrieveUserId } : {}),
        }),
      })
      const data: RetrieveResult = await res.json()
      if (!res.ok) {
        setRetrieveError((data as unknown as { error: string }).error || 'Error')
        setPipeline(EMPTY_PIPELINE)
        return
      }
      setRetrieveResult(data)
      setPipeline(buildPipelineData(data.stages ?? [], 'retrieve', data.cache_hit ?? false, data.cached_answer, {
        rewrittenQuery: data.rewritten_query,
        hydeUsed: data.hyde_used,
        topK: retrieveTopK,
        topN: retrieveTopN,
      }))
    } catch {
      setRetrieveError('Failed to connect to RAG service')
      setPipeline(EMPTY_PIPELINE)
    } finally {
      setRetrieveLoading(false)
    }
  }

  // ── Full Pipeline Query (calls /query → LLM) ──
  const runFullQuery = async () => {
    if (!retrieveQuery.trim()) return
    setFullQueryLoading(true)
    setRetrieveError(null)
    setRetrieveResult(null)
    setFullQueryResult(null)
    setPipeline({ ...EMPTY_PIPELINE, status: 'loading', mode: 'full' })
    try {
      const res = await fetch('/api/pipeline-query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: retrieveQuery,
          ...buildNsPayload(retrieveNs),
          top_k: retrieveTopK,
          top_n_rerank: retrieveTopN,
          use_graph: retrieveUseGraph,
          use_rerank: retrieveUseRerank,
          use_cache: retrieveUseCache,
          use_memory: retrieveUseMemory,
          use_rewrite: retrieveUseRewrite,
          use_hyde: retrieveUseHyde,
          ...(retrieveUserId ? { user_id: retrieveUserId } : {}),
        }),
      })
      const data: FullQueryResult = await res.json()
      if (!res.ok) {
        setRetrieveError((data as unknown as { error: string }).error || 'Error')
        setPipeline(EMPTY_PIPELINE)
        return
      }
      setFullQueryResult(data)
      setPipeline(buildPipelineData(data.stages ?? [], 'full', data.from_cache ?? false, undefined, {
        rewrittenQuery: data.rewritten_query,
        hydeUsed: data.hyde_used,
        topK: retrieveTopK,
        topN: retrieveTopN,
      }))
    } catch {
      setRetrieveError('Failed to connect to RAG service')
      setPipeline(EMPTY_PIPELINE)
    } finally {
      setFullQueryLoading(false)
    }
  }

  // ── Documents ──
  const loadDocuments = useCallback(async (ns: string) => {
    setDocsLoading(true)
    try {
      const res = await fetch(`/api/documents?namespace=${ns}`)
      if (res.ok) setDocuments(await res.json())
    } catch { /* ignore */ }
    finally { setDocsLoading(false) }
  }, [])

  useEffect(() => {
    if (activeTab === 'documents' || activeTab === 'chunks') loadDocuments(docsNs)
  }, [activeTab, docsNs, loadDocuments])

  // ── Chunks ──
  const loadChunks = async (doc: Document) => {
    setSelectedDoc(doc)
    setActiveChunk(0)
    setChunks([])
    setChunksLoading(true)
    try {
      const res = await fetch(`/api/documents/${doc.id}/chunks?namespace=${doc.namespace}`)
      if (res.ok) {
        const data = await res.json()
        setChunks(data.chunks || [])
      }
    } catch { /* ignore */ }
    finally { setChunksLoading(false) }
  }

  // ── Graph ──
  const runGraphQuery = async () => {
    if (!graphQuery.trim()) return
    setGraphLoading(true)
    setGraphError(null)
    try {
      const res = await fetch('/api/graph/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query_text: graphQuery, namespace: graphNs, max_hops: 2 }),
      })
      const data = await res.json()
      if (!res.ok) { setGraphError(data.error || 'Error'); return }
      // Map API shape → GraphEntity/GraphRelation internal shape
      const rawEntities: Array<{ id: string; name: string; label?: string; type?: string }> = data.entities || []
      const rawRelations: Array<{ source_entity_id?: string; target_entity_id?: string; source?: string; target?: string; relation_type: string }> = data.relations || []
      const idToName: Record<string, string> = {}
      rawEntities.forEach(e => { idToName[e.id] = e.name })
      setGraphEntities(rawEntities.map(e => ({ name: e.name, type: e.label ?? e.type ?? 'CONCEPT', id: e.id })))
      setGraphRelations(rawRelations.map(r => ({
        source: idToName[r.source_entity_id ?? ''] ?? r.source ?? r.source_entity_id ?? '',
        target: idToName[r.target_entity_id ?? ''] ?? r.target ?? r.target_entity_id ?? '',
        relation_type: r.relation_type,
      })))
    } catch {
      setGraphError('Graph service unavailable')
    } finally {
      setGraphLoading(false)
    }
  }

  // ── Memory ──
  const loadMemoryUsers = useCallback(async () => {
    setMemoryLoading(true)
    try {
      const res = await fetch('/api/memory/users')
      if (res.ok) {
        const data = await res.json()
        setMemoryUsers(data || [])
      }
    } catch { /* ignore */ }
    finally { setMemoryLoading(false) }
  }, [])

  const loadUserMemory = async (userId: string) => {
    setSelectedUser(userId)
    setMemoryLoading(true)
    setMemoryEntries([])
    try {
      const res = await fetch(`/api/memory/${encodeURIComponent(userId)}`)
      if (res.ok) {
        const data = await res.json()
        // API returns array directly (route already normalises it)
        setMemoryEntries(Array.isArray(data) ? data : (data.entries ?? []))
      }
    } catch { /* ignore */ }
    finally { setMemoryLoading(false) }
  }

  useEffect(() => {
    if (activeTab === 'memory') loadMemoryUsers()
  }, [activeTab, loadMemoryUsers])

  // ── Cache ──
  const loadCache = useCallback(async (ns: string) => {
    setCacheLoading(true)
    try {
      const url = ns ? `/api/cache?namespace=${ns}` : '/api/cache'
      const res = await fetch(url)
      if (res.ok) setCacheEntries(await res.json())
    } catch { /* ignore */ }
    finally { setCacheLoading(false) }
  }, [])

  useEffect(() => {
    if (activeTab === 'cache') loadCache(cacheNs)
  }, [activeTab, cacheNs, loadCache])

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <div className="shrink-0 border-b border-gray-800 px-6 py-3">
        <h1 className="text-base font-semibold text-white">Knowledge Base Preview</h1>
        <p className="text-xs text-gray-500">Inspect retrieval pipeline, documents, chunks, graph, memory, and cache</p>
      </div>

      {/* Tabs */}
      <div className="shrink-0 px-6">
        <Tabs tabs={TABS} active={activeTab} onChange={setActiveTab} />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden flex flex-col">

        {/* ── RETRIEVAL PREVIEW ─────────────────────────────────── */}
        {activeTab === 'retrieval' && (
          <div className="flex-1 flex flex-col min-h-0 p-4 gap-3">

            {/* ── Controls bar ── */}
            <div className="shrink-0 bg-gray-900 border border-gray-800 rounded-xl p-3 space-y-2.5">
              {/* Row 1: query + mode toggle + run */}
              <div className="flex gap-2 items-end">
                <div className="flex-1 min-w-0">
                  <label className="block text-[10px] text-gray-500 mb-1">Query</label>
                  <input
                    value={retrieveQuery}
                    onChange={e => setRetrieveQuery(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && (pipelineMode === 'full' ? runFullQuery() : runRetrieve())}
                    placeholder="Enter a query to preview retrieval…"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-purple-500"
                  />
                </div>
                {/* Mode toggle pill */}
                <div className="shrink-0 flex rounded-lg overflow-hidden border border-gray-700 text-xs font-medium self-end">
                  <button
                    onClick={() => setPipelineMode('retrieve')}
                    className={`px-3 py-1.5 transition-colors ${pipelineMode === 'retrieve' ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-500 hover:text-gray-300'}`}
                    title="Inspect pipeline — vector search + rerank, no LLM (~3–5s)"
                  >
                    🔍 Inspect
                  </button>
                  <button
                    onClick={() => setPipelineMode('full')}
                    className={`px-3 py-1.5 transition-colors border-l border-gray-700 ${pipelineMode === 'full' ? 'bg-green-700 text-white' : 'bg-gray-800 text-gray-500 hover:text-gray-300'}`}
                    title="Generative pipeline — retrieval + LLM answer (~30–60s)"
                  >
                    ⚡ Generate
                  </button>
                </div>
                {/* Run button */}
                <button
                  onClick={pipelineMode === 'full' ? runFullQuery : runRetrieve}
                  disabled={retrieveLoading || fullQueryLoading || !retrieveQuery.trim()}
                  className={`shrink-0 px-5 py-1.5 disabled:opacity-50 text-white text-sm rounded-lg font-medium transition-colors self-end ${pipelineMode === 'full' ? 'bg-green-700 hover:bg-green-600' : 'bg-purple-600 hover:bg-purple-500'}`}
                >
                  {(retrieveLoading || fullQueryLoading)
                    ? (pipelineMode === 'full' ? 'Generating…' : 'Searching…')
                    : 'Run'}
                </button>
              </div>

              {/* Row 2: parameters */}
              <div className="flex flex-wrap gap-3 items-end">
                <div className="w-44">
                  <label className="block text-[10px] text-gray-500 mb-1">Namespace(s) <span className="text-gray-700">comma-sep</span></label>
                  <input
                    value={retrieveNs}
                    onChange={e => setRetrieveNs(e.target.value)}
                    placeholder="default  or  hr, legal"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-300 placeholder-gray-700 focus:outline-none focus:border-purple-500"
                  />
                </div>
                <div className="w-36">
                  <label className="block text-[10px] text-gray-500 mb-1">User ID <span className="text-gray-700">(short/long memory)</span></label>
                  <input
                    value={retrieveUserId}
                    onChange={e => setRetrieveUserId(e.target.value)}
                    placeholder="e.g. user_123"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-cyan-500"
                  />
                </div>
                <div className="w-16">
                  <label className="block text-[10px] text-gray-500 mb-1">Top K</label>
                  <input
                    type="number" min={1} max={50}
                    value={retrieveTopK}
                    onChange={e => setRetrieveTopK(Number(e.target.value))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-purple-500 text-center"
                  />
                </div>
                <div className="w-16">
                  <label className="block text-[10px] text-gray-500 mb-1">Top N</label>
                  <input
                    type="number" min={1} max={20}
                    value={retrieveTopN}
                    onChange={e => setRetrieveTopN(Number(e.target.value))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-purple-500 text-center"
                  />
                </div>

                {/* Toggles row */}
                <div className="flex flex-wrap items-center gap-4 pb-0.5">
                  {([
                    { label: 'Graph',   val: retrieveUseGraph,   set: setRetrieveUseGraph,   color: 'bg-emerald-600' },
                    { label: 'Rerank',  val: retrieveUseRerank,  set: setRetrieveUseRerank,  color: 'bg-amber-600'   },
                    { label: 'Cache',   val: retrieveUseCache,   set: setRetrieveUseCache,   color: 'bg-violet-600'  },
                    { label: 'Memory',  val: retrieveUseMemory,  set: setRetrieveUseMemory,  color: 'bg-cyan-600'    },
                    { label: 'Rewrite', val: retrieveUseRewrite, set: setRetrieveUseRewrite, color: 'bg-purple-600'  },
                    { label: 'HyDE',    val: retrieveUseHyde,    set: setRetrieveUseHyde,    color: 'bg-pink-600'    },
                  ] as { label: string; val: boolean; set: (v: (p: boolean) => boolean) => void; color: string }[]).map(t => (
                    <label key={t.label} className="flex items-center gap-1.5 cursor-pointer select-none">
                      <div onClick={() => t.set(v => !v)}
                        className={`w-8 h-4 rounded-full transition-colors relative ${t.val ? t.color : 'bg-gray-700'}`}>
                        <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${t.val ? 'translate-x-4' : 'translate-x-0.5'}`} />
                      </div>
                      <span className="text-[11px] text-gray-400">{t.label}</span>
                    </label>
                  ))}
                </div>

                {/* Mock + Reset */}
                <div className="flex items-center gap-2 ml-auto flex-wrap">
                  <span className="text-[10px] text-gray-600">Mock data:</span>
                  <button onClick={() => loadMock(true)}
                    className="px-2.5 py-1.5 text-[11px] bg-emerald-900/30 border border-emerald-700/40 text-emerald-400 rounded-lg hover:bg-emerald-800/40 transition-colors">
                    ⚡ With Graph
                  </button>
                  <button onClick={() => loadMock(false)}
                    className="px-2.5 py-1.5 text-[11px] bg-blue-900/30 border border-blue-700/40 text-blue-400 rounded-lg hover:bg-blue-800/40 transition-colors">
                    📄 Vector Only
                  </button>
                  {pipeline.status === 'done' && (
                    <button
                      onClick={() => { setRetrieveResult(null); setFullQueryResult(null); setPipeline(EMPTY_PIPELINE); setRetrieveQuery('') }}
                      className="text-[11px] text-gray-600 hover:text-gray-400 transition-colors">
                      Reset
                    </button>
                  )}
                </div>
              </div>

              {retrieveError && <p className="text-xs text-red-400">{retrieveError}</p>}
            </div>

            {/* ── Pipeline + Results ── */}
            <div className="flex-1 min-h-0 flex gap-3">

              {/* Pipeline — fills height */}
              <div className="flex-1 min-h-0 min-w-0 bg-gray-900 border border-gray-800 rounded-xl p-4 flex flex-col">
                <div className="flex items-center justify-between mb-2 shrink-0">
                  <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Pipeline</span>
                  {pipeline.status === 'done' && (
                    <span className={`text-[10px] ${pipeline.mode === 'full' ? 'text-green-400' : 'text-amber-500'}`}>
                      {pipeline.mode === 'full' ? 'generative pipeline — LLM included' : `${pipeline.activeNodes.size} stages fired`}
                    </span>
                  )}
                </div>
                <div className="flex-1 min-h-0 flex flex-col justify-center">
                  <PipelineDiagram pipeline={pipeline} systemConfig={systemConfig} />
                </div>
              </div>

              {/* Results panel */}
              {(retrieveResult || fullQueryResult) && (
                <div className="w-96 shrink-0 flex flex-col gap-3 overflow-y-auto">

                  {/* ── Status badges ── */}
                  <div className="shrink-0 flex flex-col gap-2">
                    {(retrieveResult?.cache_hit || fullQueryResult?.from_cache) && (
                      <div className="bg-violet-900/25 border border-violet-700/40 rounded-xl px-3 py-1.5 flex items-center gap-2">
                        <span className="text-violet-300 text-xs font-semibold">⚡ Semantic Cache Hit</span>
                        <span className="text-[10px] text-violet-500 ml-auto">all downstream stages skipped</span>
                      </div>
                    )}
                    {(retrieveResult?.knowledge_gap || fullQueryResult?.knowledge_gap) && (
                      <div className="bg-red-900/25 border border-red-700/40 rounded-xl px-3 py-1.5 flex items-center gap-2">
                        <span className="text-red-300 text-xs font-semibold">⚠ Knowledge Gap</span>
                        <span className="text-[10px] text-red-400 ml-auto">top score {((retrieveResult?.top_rerank_score ?? fullQueryResult?.top_rerank_score ?? 0) * 100).toFixed(1)}%</span>
                      </div>
                    )}
                    {fullQueryResult?.low_confidence && (
                      <div className="bg-orange-900/20 border border-orange-700/40 rounded-xl px-3 py-1.5 flex items-center gap-2">
                        <span className="text-orange-300 text-xs font-semibold">⚠ Low Confidence</span>
                        <span className="text-[10px] text-orange-500 ml-auto">verify answer</span>
                      </div>
                    )}
                  </div>

                  {/* ── OUTPUT (always visible) ── */}
                  {/* Cache answer — retrieve hit OR full pipeline cache hit */}
                  {(retrieveResult?.cache_hit && retrieveResult?.cached_answer) && (
                    <div className="shrink-0 bg-gray-900 border border-violet-700/40 rounded-xl p-3">
                      <h3 className="text-[10px] font-semibold text-violet-400 uppercase tracking-wider mb-2">⚡ Cached Answer</h3>
                      <ExpandableText text={retrieveResult.cached_answer} />
                    </div>
                  )}
                  {(fullQueryResult?.from_cache && fullQueryResult?.answer) && (
                    <div className="shrink-0 bg-gray-900 border border-violet-700/40 rounded-xl p-3">
                      <h3 className="text-[10px] font-semibold text-violet-400 uppercase tracking-wider mb-2">⚡ Cached Answer</h3>
                      <ExpandableText text={fullQueryResult.answer} />
                    </div>
                  )}

                  {/* LLM Answer — only when not from cache */}
                  {fullQueryResult?.answer && !fullQueryResult.from_cache && (
                    <div className="shrink-0 bg-gray-900 border border-green-800/40 rounded-xl p-3">
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="text-[10px] font-semibold text-green-500 uppercase tracking-wider">◆ LLM Answer</h3>
                        {fullQueryResult.low_confidence && <span className="text-[10px] text-orange-400">⚠ low confidence</span>}
                      </div>
                      <ExpandableText text={fullQueryResult.answer} />
                    </div>
                  )}

                  {/* Retrieve-only output summary */}
                  {retrieveResult && !retrieveResult.cache_hit && !fullQueryResult && (
                    <div className="shrink-0 bg-gray-900 border border-purple-800/40 rounded-xl p-3">
                      <h3 className="text-[10px] font-semibold text-purple-400 uppercase tracking-wider mb-2">▣ Retrieved Chunks</h3>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500">
                        <span><span className="text-gray-200 font-medium">{retrieveResult.chunks.length}</span> chunks returned</span>
                        <span><span className="text-gray-400 font-medium">{retrieveResult.total_chunks_before_rerank}</span> before rerank</span>
                        {retrieveResult.chunks[0] && <span>top score <span className="text-amber-400 font-medium">{(retrieveResult.chunks[0].score * 100).toFixed(1)}%</span></span>}
                        <span><span className="text-gray-400 font-medium">{retrieveResult.retrieval_latency_ms.toFixed(0)}</span> ms</span>
                      </div>
                    </div>
                  )}

                  {/* ── Stats ── only render if there's something to show */}
                  {(() => {
                    const hasTimings = !!(fullQueryResult && !fullQueryResult.from_cache)
                    const graphEntities = retrieveResult?.graph_entities ?? fullQueryResult?.graph_entities ?? []
                    const hasGraphEntities = graphEntities.length > 0
                    const hasMemory = (retrieveResult?.memory_context_chars ?? 0) > 0 || (fullQueryResult?.memory_context_chars ?? 0) > 0
                    const hasRewrite = !!(retrieveResult?.rewritten_query || fullQueryResult?.rewritten_query)
                    const hasHyde = !!(retrieveResult?.hyde_used || fullQueryResult?.hyde_used)
                    if (!hasTimings && !hasGraphEntities && !hasMemory && !hasRewrite && !hasHyde) return null
                    return (
                      <div className="shrink-0 bg-gray-900 border border-gray-800 rounded-xl p-3">
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500">
                          {hasTimings && <>
                            <span><span className="text-gray-300 font-medium">{fullQueryResult!.retrieval_latency_ms.toFixed(0)}</span> ms retrieve</span>
                            <span><span className="text-green-400 font-medium">{fullQueryResult!.generation_latency_ms.toFixed(0)}</span> ms generate</span>
                            <span><span className="text-gray-300 font-medium">{fullQueryResult!.total_latency_ms.toFixed(0)}</span> ms total</span>
                            <span><span className={`font-medium ${fullQueryResult!.grounding_score > 0.7 ? 'text-green-400' : fullQueryResult!.grounding_score > 0.4 ? 'text-amber-400' : 'text-red-400'}`}>{(fullQueryResult!.grounding_score * 100).toFixed(0)}%</span> grounded</span>
                          </>}
                          {hasGraphEntities && (
                            <span><span className="text-emerald-400 font-medium">{graphEntities.length}</span> graph entities</span>
                          )}
                          {hasMemory && (
                            <span><span className="text-cyan-400 font-medium">{(retrieveResult?.memory_context_chars ?? fullQueryResult?.memory_context_chars ?? 0).toLocaleString()}</span> memory chars</span>
                          )}
                          {hasRewrite && (
                            <span className="w-full text-cyan-500 truncate">↺ {retrieveResult?.rewritten_query ?? fullQueryResult?.rewritten_query}</span>
                          )}
                          {hasHyde && (
                            <span className="text-pink-400">HyDE used</span>
                          )}
                        </div>
                      </div>
                    )
                  })()}

                  {/* Sub-queries */}
                  {fullQueryResult?.sub_queries && (fullQueryResult.sub_queries as string[]).length > 0 && (
                    <div className="shrink-0 bg-gray-900 border border-gray-800 rounded-xl p-3">
                      <h3 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Sub-queries (ReAct)</h3>
                      <ol className="space-y-1">
                        {(fullQueryResult.sub_queries as string[]).map((q, i) => (
                          <li key={i} className="text-[11px] text-gray-400 flex gap-2">
                            <span className="text-gray-600 shrink-0">{i + 1}.</span>{q}
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}

                  {/* Stage timings */}
                  {(() => {
                    const stages = retrieveResult?.stages ?? fullQueryResult?.stages ?? []
                    if (!stages.length) return null
                    return (
                      <div className="shrink-0 bg-gray-900 border border-gray-800 rounded-xl p-3">
                        <h3 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Stage Timings</h3>
                        <table className="w-full text-[10px]">
                          <tbody>
                            {stages.map((s, i) => (
                              <tr key={i} className={s.fired ? '' : 'opacity-30'}>
                                <td className="py-0.5 pr-2 font-mono text-gray-500">{s.stage}</td>
                                <td className="py-0.5 pr-2">
                                  <span className={`px-1 py-0.5 rounded text-[9px] ${s.fired ? 'bg-green-900/50 text-green-400' : 'bg-gray-800 text-gray-600'}`}>
                                    {s.fired ? '✓' : '✗'}
                                  </span>
                                </td>
                                <td className="py-0.5 text-right font-mono text-gray-400">
                                  {s.fired && s.latency_ms > 0 ? `${s.latency_ms.toFixed(1)}ms` : '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )
                  })()}

                  {/* Chunks / Citations */}
                  {(retrieveResult?.chunks ?? fullQueryResult?.citations ?? []).length > 0 && (
                    <div className="shrink-0 bg-gray-900 border border-gray-800 rounded-xl p-3">
                      <h3 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
                        {fullQueryResult ? 'Citations' : 'Chunks'}
                      </h3>
                      <div className="flex flex-col gap-2">
                        {(retrieveResult?.chunks ?? fullQueryResult?.citations ?? []).map((chunk, i) => (
                          <div key={chunk.chunk_id} className="border border-gray-800 rounded-lg p-2.5">
                            <div className="flex items-center justify-between mb-1.5">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className="text-[10px] font-mono text-purple-400 shrink-0">#{i + 1}</span>
                                <span className="text-[11px] text-gray-300 font-medium truncate">{chunk.filename}</span>
                                <span className="text-[9px] bg-gray-800 text-gray-500 px-1 py-0.5 rounded shrink-0">{chunk.stage}</span>
                              </div>
                              <div className="w-20 shrink-0 ml-2">
                                <ChunkScoreBar score={chunk.score} />
                              </div>
                            </div>
                            <p className="text-[11px] text-gray-400 leading-relaxed line-clamp-3">{chunk.text_snippet}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Graph entities */}
                  {((retrieveResult?.graph_entities ?? fullQueryResult?.graph_entities ?? []).length > 0) && (
                    <div className="shrink-0 bg-gray-900 border border-gray-800 rounded-xl p-3">
                      <h3 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
                        {fullQueryResult ? 'Graph Entities Used' : 'Graph Entities'}
                      </h3>
                      <div className="flex flex-wrap gap-1.5">
                        {(retrieveResult?.graph_entities ?? fullQueryResult?.graph_entities ?? []).map((e, i) => (
                          <span key={i} className="text-[10px] bg-emerald-600/20 border border-emerald-700/30 text-emerald-300 px-2 py-0.5 rounded-full">
                            {e.name} <span className="text-emerald-600">({e.type})</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

          </div>
        )}

        {/* ── DOCUMENTS ─────────────────────────────────────────── */}
        {activeTab === 'documents' && (
          <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-4 max-w-4xl">
            <div className="flex items-center gap-2">
              <input
                value={docsNs}
                onChange={e => setDocsNs(e.target.value)}
                placeholder="namespace"
                className="w-36 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-300 focus:outline-none focus:border-purple-500"
              />
              <button
                onClick={() => loadDocuments(docsNs)}
                className="px-3 py-1.5 bg-gray-800 border border-gray-700 hover:border-gray-500 text-gray-300 text-sm rounded-lg transition-colors"
              >
                Refresh
              </button>
              <span className="text-xs text-gray-600">{documents.length} documents</span>
            </div>

            {docsLoading ? (
              <div className="text-gray-600 text-sm">Loading…</div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {documents.map(doc => (
                  <button
                    key={doc.id}
                    onClick={() => { setActiveTab('chunks'); loadChunks(doc) }}
                    className="bg-gray-900 border border-gray-800 hover:border-purple-700/50 rounded-xl p-4 text-left transition-colors group"
                  >
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <span className="text-sm font-medium text-gray-200 group-hover:text-white truncate">
                        {doc.filename}
                      </span>
                      <span className="text-[10px] bg-gray-800 text-gray-500 px-2 py-0.5 rounded shrink-0">
                        {doc.content_type.split('/')[1] || doc.content_type}
                      </span>
                    </div>

                    {/* Chunk count visual */}
                    <div className="mb-2">
                      <div className="flex flex-wrap gap-1">
                        {Array.from({ length: Math.min(doc.chunk_count, 20) }).map((_, i) => (
                          <div key={i} className="w-2.5 h-2.5 rounded-sm bg-purple-600/40 group-hover:bg-purple-500/60 transition-colors" />
                        ))}
                        {doc.chunk_count > 20 && (
                          <span className="text-[9px] text-gray-600">+{doc.chunk_count - 20}</span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-[10px] text-gray-600">
                      <span>{doc.chunk_count} chunks</span>
                      {doc.ingested_at && (
                        <span>{new Date(doc.ingested_at).toLocaleDateString()}</span>
                      )}
                    </div>

                    <div className="mt-1 text-[9px] font-mono text-gray-700 truncate">{doc.id}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
          </div>
        )}

        {/* ── CHUNK INSPECTOR ────────────────────────────────────── */}
        {activeTab === 'chunks' && (
          <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-4 max-w-4xl">
            {/* Doc selector */}
            <div className="flex items-center gap-3">
              <select
                value={selectedDoc?.id || ''}
                onChange={e => {
                  const doc = documents.find(d => d.id === e.target.value)
                  if (doc) loadChunks(doc)
                }}
                className="flex-1 max-w-sm bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-300 focus:outline-none focus:border-purple-500"
              >
                <option value="">Select a document…</option>
                {documents.map(d => (
                  <option key={d.id} value={d.id}>{d.filename}</option>
                ))}
              </select>
              {selectedDoc && (
                <span className="text-xs text-gray-500">{chunks.length} chunks loaded</span>
              )}
            </div>

            {chunksLoading && <div className="text-gray-600 text-sm">Loading chunks…</div>}

            {chunks.length > 0 && (
              <>
                {/* Block map */}
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                    Chunk Map — {selectedDoc?.filename}
                  </h3>
                  <div className="flex flex-wrap gap-1.5 overflow-y-auto max-h-28">
                    {chunks.map((chunk, i) => (
                      <ChunkBlock
                        key={chunk.chunk_id}
                        chunk={chunk}
                        active={activeChunk === i}
                        onClick={() => setActiveChunk(i)}
                      />
                    ))}
                  </div>
                </div>

                {/* Active chunk viewer */}
                {chunks[activeChunk] && (
                  <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-mono text-purple-400">
                          Chunk {chunks[activeChunk].sequence_index}
                        </span>
                        <span className="text-[10px] text-gray-600 font-mono">
                          {chunks[activeChunk].chunk_id.slice(0, 12)}…
                        </span>
                        <span className="text-[10px] text-gray-500">
                          {chunks[activeChunk].char_count} chars
                        </span>
                      </div>
                      <div className="flex gap-1">
                        <button
                          onClick={() => setActiveChunk(Math.max(0, activeChunk - 1))}
                          disabled={activeChunk === 0}
                          className="px-2 py-1 text-[10px] bg-gray-800 border border-gray-700 rounded hover:border-gray-500 disabled:opacity-40 text-gray-400"
                        >
                          ← Prev
                        </button>
                        <button
                          onClick={() => setActiveChunk(Math.min(chunks.length - 1, activeChunk + 1))}
                          disabled={activeChunk === chunks.length - 1}
                          className="px-2 py-1 text-[10px] bg-gray-800 border border-gray-700 rounded hover:border-gray-500 disabled:opacity-40 text-gray-400"
                        >
                          Next →
                        </button>
                      </div>
                    </div>
                    <pre className="text-xs text-gray-300 whitespace-pre-wrap leading-relaxed font-mono bg-gray-800/50 rounded-lg p-3 max-h-72 overflow-y-auto">
                      {chunks[activeChunk].text}
                    </pre>
                  </div>
                )}
              </>
            )}

            {!chunksLoading && !selectedDoc && (
              <div className="text-gray-600 text-sm text-center py-12">
                Select a document from the Documents tab or the dropdown above
              </div>
            )}
          </div>
          </div>
        )}

        {/* ── GRAPH BROWSER ─────────────────────────────────────── */}
        {activeTab === 'graph' && (
          <div className="flex-1 flex flex-col gap-3 p-4 min-h-0">
            <div className="shrink-0 flex gap-2">
              <input
                value={graphQuery}
                onChange={e => setGraphQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && runGraphQuery()}
                placeholder="Query graph (e.g. 'machine learning', 'Paris')…"
                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-purple-500"
              />
              <input
                value={graphNs}
                onChange={e => setGraphNs(e.target.value)}
                placeholder="namespace"
                className="w-28 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-purple-500"
              />
              <button
                type="button"
                onClick={runGraphQuery}
                disabled={graphLoading || !graphQuery.trim()}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-sm rounded-lg font-medium"
              >
                {graphLoading ? 'Querying…' : 'Query'}
              </button>
              <button
                onClick={loadGraphMock}
                title="Load mock graph data (ML/AI knowledge graph)"
                className="flex items-center gap-1.5 px-3 py-2 text-xs bg-emerald-900/30 border border-emerald-700/40 text-emerald-400 rounded-lg hover:bg-emerald-800/40 transition-colors shrink-0"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Mock Data
              </button>
            </div>

            {graphError && <p className="text-xs text-red-400 shrink-0">{graphError}</p>}

            {/* Legend */}
            {graphEntities.length > 0 && (
              <div className="shrink-0 flex flex-wrap gap-2">
                {Object.entries(TYPE_COLOR).map(([type, color]) => {
                  if (!graphEntities.some(e => e.type === type)) return null
                  return (
                    <span key={type} className="flex items-center gap-1 text-[10px] text-gray-400">
                      <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: color }} />
                      {type}
                    </span>
                  )
                })}
                <span className="text-[10px] text-gray-600 ml-2">
                  {graphEntities.length} entities · {graphRelations.length} relations
                </span>
              </div>
            )}

            {/* Canvas */}
            <GraphCanvasWrapper entities={graphEntities} relations={graphRelations} />
          </div>
        )}

        {/* ── MEMORY ────────────────────────────────────────────── */}
        {activeTab === 'memory' && (
          <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-2xl space-y-4">

            {/* Summary row */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-4">
                <p className="text-xs text-gray-500 mb-1">Users with memory</p>
                <p className="text-2xl font-bold text-white">{memoryLoading ? '—' : memoryUsers.length}</p>
                <p className="text-[10px] text-gray-600 mt-1">Long-term (Postgres)</p>
              </div>
              <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-4">
                <p className="text-xs text-gray-500 mb-1">Total entries</p>
                <p className="text-2xl font-bold text-purple-400">
                  {memoryLoading ? '—' : memoryUsers.reduce((s, u) => s + u.entry_count, 0)}
                </p>
                <p className="text-[10px] text-gray-600 mt-1">across all users</p>
              </div>
            </div>

            {/* Per-user accordion */}
            <div className="rounded-xl border border-gray-800 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 bg-gray-800/40 border-b border-gray-800">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">User Memory Report</p>
                <a
                  href="/memory"
                  target="_blank"
                  className="text-[10px] text-purple-400 hover:text-purple-300 flex items-center gap-1 transition-colors"
                >
                  Manage in Memory Manager
                  <svg width={9} height={9} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                </a>
              </div>

              {memoryLoading ? (
                <div className="divide-y divide-gray-800">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="h-12 bg-gray-800/20 animate-pulse" />
                  ))}
                </div>
              ) : memoryUsers.length === 0 ? (
                <div className="py-10 text-center text-gray-600">
                  <p className="text-sm">No users found</p>
                  <p className="text-xs mt-1">
                    Add memory at{' '}
                    <a href="/memory" target="_blank" className="text-purple-500 hover:text-purple-400 underline">
                      Memory Manager →
                    </a>
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-gray-800">
                  {memoryUsers.map((u) => (
                    <div key={u.user_id}>
                      <button
                        onClick={() => {
                          if (selectedUser === u.user_id) {
                            setSelectedUser('')
                            setMemoryEntries([])
                          } else {
                            loadUserMemory(u.user_id)
                          }
                        }}
                        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-800/40 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-7 h-7 rounded-full bg-purple-900/40 border border-purple-700/40 flex items-center justify-center text-[10px] text-purple-300 font-semibold uppercase">
                            {u.user_id.slice(0, 2)}
                          </div>
                          <div className="text-left">
                            <p className="text-sm text-white font-medium">{u.user_id}</p>
                            {u.last_updated && (
                              <p className="text-[10px] text-gray-600">
                                last updated {new Date(u.last_updated).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-mono text-gray-500">{u.entry_count} entries</span>
                          <svg
                            className={`w-4 h-4 text-gray-600 transition-transform ${selectedUser === u.user_id ? 'rotate-180' : ''}`}
                            fill="none" stroke="currentColor" viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </button>

                      {selectedUser === u.user_id && (
                        <div className="border-t border-gray-800 bg-gray-900/40 px-4 py-3">
                          {memoryLoading ? (
                            <p className="text-xs text-gray-600">Loading…</p>
                          ) : (
                            <MemoryTimeline entries={memoryEntries} />
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
          </div>
        )}

        {/* ── CACHE ─────────────────────────────────────────────── */}
        {activeTab === 'cache' && (
          <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-4 max-w-3xl">
            <div className="flex items-center gap-2">
              <input
                value={cacheNs}
                onChange={e => setCacheNs(e.target.value)}
                placeholder="Filter by namespace (optional)…"
                className="w-56 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-300 focus:outline-none focus:border-purple-500"
              />
              <button
                onClick={() => loadCache(cacheNs)}
                className="px-3 py-1.5 bg-gray-800 border border-gray-700 hover:border-gray-500 text-gray-300 text-sm rounded-lg"
              >
                Refresh
              </button>
              <span className="text-xs text-gray-600">{cacheEntries.length} entries</span>
            </div>

            {cacheLoading ? (
              <div className="text-gray-600 text-sm">Loading…</div>
            ) : (
              <CacheList entries={cacheEntries} />
            )}
          </div>
          </div>
        )}

      </div>
    </div>
  )
}
