'use client'

import { useLayoutEffect, useMemo, useRef, useState } from 'react'

type Mode = 'text' | 'web' | 'file'

type PreviewStage = { stage: string; fired: boolean; latency_ms: number; meta?: Record<string, unknown> }
type PreviewChunk = { chunk_id: string; sequence_index: number; chunk_type: string; text_snippet: string; char_count: number; token_count: number; parent_chunk_id?: string | null; embedding_dims: number }
type PreviewEntity = { id: string; label: string; name: string; source_doc_ids: string[] }
type PreviewRelation = { id: string; source_entity_id: string; target_entity_id: string; relation_type: string; source_doc_id: string }
type PreviewStorageAction = { target: string; action: string; reason: string }

type IngestPreviewResult = {
  preview_id: string
  filename: string
  namespace: string
  mime_type: string
  content_source: string
  source_url?: string | null
  source_hash: string
  duplicate_detected: boolean
  duplicate_document_id?: string | null
  dry_run: boolean
  raw_chars: number
  parsed_chars: number
  chunk_count: number
  total_tokens: number
  parsed_preview: string
  stages: PreviewStage[]
  chunks: PreviewChunk[]
  graph_entities: PreviewEntity[]
  graph_relations: PreviewRelation[]
  storage_plan: PreviewStorageAction[]
  warnings: string[]
  validation_status?: string
  validation_issues?: string[]
  validation_summary?: string
  chunker_strategy: string
  chunk_mode: string
  chunk_fallback_reason: string
  embedding_provider: string
  embedding_model: string
  graph_extraction_mode: string
  graph_extractor_backend: string
  graph_system_prompt_source: string
  graph_system_prompt_overridden: boolean
  graph_llm_provider: string
  graph_llm_model: string
}

type PipelineStatus = 'idle' | 'loading' | 'done'

type PipelineNode = {
  id: string
  label: string
  sublabel?: string
  icon: string
  x: number
  y: number
  w: number
  h: number
  color: string
}

const STAGES = ['input', 'parse', 'chunk', 'embed', 'graph', 'persist']
const NODES = [
  { id: 'input',   label: 'Input',   sublabel: 'Text / Web / File', icon: '⬦', x: 10,  y: 98, w: 72, h: 26, color: '#4b5563' },
  { id: 'parse',   label: 'Parse',   sublabel: 'Normalize',         icon: '✦', x: 106, y: 98, w: 74, h: 26, color: '#8b5cf6' },
  { id: 'chunk',   label: 'Chunk',   sublabel: 'Split content',     icon: '▣', x: 208, y: 98, w: 78, h: 26, color: '#2563eb' },
  { id: 'embed',   label: 'Embed',   sublabel: 'Vectorize',         icon: '⊕', x: 316, y: 98, w: 80, h: 26, color: '#059669' },
  { id: 'graph',   label: 'Graph',   sublabel: 'Extract entities',  icon: '⬡', x: 426, y: 98, w: 78, h: 26, color: '#d97706' },
  { id: 'persist', label: 'Persist', sublabel: 'Store result',      icon: '◆', x: 534, y: 98, w: 86, h: 26, color: '#dc2626' },
] satisfies PipelineNode[]

const NODE_PURPOSE: Record<string, string> = {
  input:   'Accepts raw text, web URL, or uploaded file as the source document.',
  parse:   'Normalizes the raw input into clean text and extracts document metadata.',
  chunk:   'Splits the document into retrieval-sized segments with configurable strategy.',
  embed:   'Converts each chunk into a dense vector for semantic similarity search.',
  graph:   'Extracts named entities and relations for knowledge graph augmentation.',
  persist: 'Determines storage targets and writes to ChromaDB, Neo4j, and PostgreSQL.',
}

// ─── Helper Components ────────────────────────────────────────────────────────

function Pill({ children, color = 'gray' }: { children: React.ReactNode; color?: string }) {
  const cls: Record<string, string> = {
    green:   'bg-green-900/40 text-green-300',
    amber:   'bg-amber-900/40 text-amber-300',
    violet:  'bg-violet-900/40 text-violet-300',
    blue:    'bg-blue-900/40 text-blue-300',
    red:     'bg-red-900/40 text-red-300',
    emerald: 'bg-emerald-900/40 text-emerald-300',
    gray:    'bg-gray-700/40 text-gray-400',
  }
  return <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${cls[color] ?? cls.gray}`}>{children}</span>
}

function StatGrid({ items }: { items: { label: string; value: React.ReactNode }[] }) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {items.map(({ label, value }) => (
        <div key={label} className="bg-gray-800 rounded-lg px-2.5 py-2">
          <div className="text-[9px] text-gray-600 uppercase tracking-wider mb-0.5">{label}</div>
          <div className="text-[11px] text-gray-200 font-medium">{value ?? '—'}</div>
        </div>
      ))}
    </div>
  )
}

function ConfigBlock({ items }: { items: { env: string; value: string }[] }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg px-2.5 py-2">
      <div className="text-[8px] text-gray-600 uppercase tracking-widest mb-1.5">Config</div>
      <div className="space-y-1">
        {items.map(({ env, value }) => (
          <div key={env} className="flex items-center justify-between gap-2 font-mono">
            <span className="text-[9px] text-gray-500 truncate">{env}</span>
            <span className="text-[9px] text-amber-400 font-semibold shrink-0">{value || '—'}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function ScoreBar({ value, max = 1 }: { value: number; max?: number }) {
  const pct = Math.min((value / max) * 100, 100)
  const color = pct >= 90 ? '#22c55e' : pct >= 60 ? '#f59e0b' : '#ef4444'
  return (
    <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
    </div>
  )
}

function ExpandableText({ text, maxLen = 300 }: { text: string; maxLen?: number }) {
  const [expanded, setExpanded] = useState(false)
  const isLong = text.length > maxLen
  return (
    <div>
      <p className={`text-[11px] text-gray-300 leading-relaxed whitespace-pre-wrap font-mono ${!expanded && isLong ? 'line-clamp-5' : ''}`}>
        {text}
      </p>
      {isLong && (
        <button onClick={() => setExpanded(v => !v)} className="mt-1 text-[10px] text-gray-600 hover:text-gray-300 transition-colors">
          {expanded ? '▲ show less' : '▼ show more'}
        </button>
      )}
    </div>
  )
}

// ─── Per-node Rich Body ───────────────────────────────────────────────────────

function renderIngestNodeBody(
  nodeId: string,
  stage: PreviewStage | undefined,
  preview: IngestPreviewResult | null,
  status: PipelineStatus,
): React.ReactNode {
  const ms = (t: number | undefined) => t != null ? `${t.toFixed(1)} ms` : '—'

  if (status === 'loading') return <p className="text-violet-400 text-[11px] animate-pulse">Running stage…</p>
  if (status === 'idle') return <p className="text-gray-600 text-[11px]">Run a preview to see live data for this stage.</p>

  const isActive = stage?.fired ?? false

  if (nodeId === 'input') {
    if (!isActive) return <p className="text-gray-500 text-[11px]">Stage not fired.</p>
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-2xl font-bold text-white">{((preview?.raw_chars ?? 0) / 1000).toFixed(1)}K</span>
          <span className="text-gray-400 text-sm">raw chars</span>
          <Pill color="green">✓ accepted</Pill>
        </div>
        <StatGrid items={[
          { label: 'Source',    value: preview?.content_source ?? '—' },
          { label: 'Latency',   value: ms(stage?.latency_ms) },
          { label: 'MIME type', value: preview?.mime_type ?? '—' },
          { label: 'Namespace', value: preview?.namespace ?? '—' },
        ]} />
        <div className="bg-gray-800 rounded-lg px-2.5 py-2">
          <div className="text-[9px] text-gray-600 uppercase tracking-wider mb-0.5">Filename</div>
          <div className="text-[11px] text-amber-300 font-mono truncate">{preview?.filename || '—'}</div>
        </div>
        {preview?.source_url && (
          <div className="bg-gray-800 rounded-lg px-2.5 py-2">
            <div className="text-[9px] text-gray-600 uppercase tracking-wider mb-0.5">Source URL</div>
            <div className="text-[10px] text-blue-400 font-mono break-all line-clamp-2">{preview.source_url}</div>
          </div>
        )}
      </div>
    )
  }

  if (nodeId === 'parse') {
    if (!isActive) return <p className="text-gray-500 text-[11px]">Stage not fired.</p>
    const ratio = preview && preview.raw_chars > 0 ? (preview.parsed_chars / preview.raw_chars) : 0
    return (
      <div className="space-y-2">
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold text-white">{((preview?.parsed_chars ?? 0) / 1000).toFixed(1)}K</span>
          <span className="text-gray-400 text-sm">parsed chars</span>
        </div>
        <div className="space-y-1">
          <div className="flex justify-between text-[9px] text-gray-600">
            <span>{preview?.raw_chars?.toLocaleString()} raw → {preview?.parsed_chars?.toLocaleString()} parsed</span>
            <span>{(ratio * 100).toFixed(0)}%</span>
          </div>
          <ScoreBar value={ratio} max={1} />
        </div>
        <StatGrid items={[
          { label: 'Raw chars',    value: preview?.raw_chars?.toLocaleString() ?? '—' },
          { label: 'Latency',      value: ms(stage?.latency_ms) },
        ]} />
        {preview?.parsed_preview && (
          <div className="bg-gray-800 rounded-lg px-2.5 py-2">
            <div className="text-[9px] text-gray-600 uppercase tracking-wider mb-1">Parsed preview</div>
            <p className="text-[10px] text-gray-400 font-mono line-clamp-4 leading-relaxed">{preview.parsed_preview.slice(0, 200)}{preview.parsed_preview.length > 200 ? '…' : ''}</p>
          </div>
        )}
      </div>
    )
  }

  if (nodeId === 'chunk') {
    if (!isActive) return <p className="text-gray-500 text-[11px]">Stage not fired.</p>
    const fallback = preview?.chunk_fallback_reason
    return (
      <div className="space-y-2">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold text-white">{preview?.chunk_count ?? '—'}</span>
          <span className="text-gray-400 text-sm">chunks</span>
          {fallback && <Pill color="amber">⚠ fallback</Pill>}
        </div>
        <StatGrid items={[
          { label: 'Total tokens', value: preview?.total_tokens?.toLocaleString() ?? '—' },
          { label: 'Latency',      value: ms(stage?.latency_ms) },
          { label: 'Strategy',     value: preview?.chunker_strategy ?? '—' },
          { label: 'Mode',         value: preview?.chunk_mode ?? '—' },
        ]} />
        {fallback && (
          <p className="text-[10px] text-amber-400">Fallback reason: {fallback}</p>
        )}
        <ConfigBlock items={[
          { env: 'CHUNKER_STRATEGY', value: preview?.chunker_strategy ?? '—' },
          { env: 'CHUNK_MODE',       value: preview?.chunk_mode ?? '—' },
        ]} />
      </div>
    )
  }

  if (nodeId === 'embed') {
    if (!isActive) return <p className="text-gray-500 text-[11px]">Stage not fired.</p>
    const dims = preview?.chunks?.[0]?.embedding_dims
    return (
      <div className="space-y-2">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold text-white">{dims ?? '—'}</span>
          <span className="text-gray-400 text-sm">vector dims</span>
          <Pill color="green">✓ vectorized</Pill>
        </div>
        <StatGrid items={[
          { label: 'Provider',     value: preview?.embedding_provider ?? '—' },
          { label: 'Latency',      value: ms(stage?.latency_ms) },
          { label: 'Model',        value: preview?.embedding_model ?? '—' },
          { label: 'Total tokens', value: preview?.total_tokens?.toLocaleString() ?? '—' },
        ]} />
        <ConfigBlock items={[
          { env: 'EMBEDDING_PROVIDER', value: preview?.embedding_provider ?? '—' },
          { env: 'EMBEDDING_MODEL',    value: preview?.embedding_model ?? '—' },
        ]} />
      </div>
    )
  }

  if (nodeId === 'graph') {
    if (!isActive) return (
      <p className="text-gray-500 text-[11px]">Graph disabled — enable <span className="text-amber-400">ENABLE_GRAPH</span> to extract entities.</p>
    )
    const entityCount = preview?.graph_entities?.length ?? 0
    const relCount = preview?.graph_relations?.length ?? 0
    const membershipCount = (preview?.graph_relations ?? []).filter(r => ['MEMBER_OF', 'PART_OF'].includes(r.relation_type)).length
    const roleCount = (preview?.graph_relations ?? []).filter(r => r.relation_type === 'HAS_ROLE').length
    const goodForCount = (preview?.graph_relations ?? []).filter(r => r.relation_type === 'GOOD_FOR').length
    const validationStatus = preview?.validation_status ?? 'unknown'
    const validationIssues = preview?.validation_issues ?? []
    const needsMembershipHint = validationIssues.some(issue =>
      issue === 'team_document_without_membership_relations' || issue === 'sparse_membership_relations'
    )
    const graphBackend = preview?.graph_extractor_backend ?? 'llm'
    const graphPromptSource = preview?.graph_system_prompt_source ?? 'unknown'
    const graphPromptOverridden = preview?.graph_system_prompt_overridden ?? false
    const graphProvider = preview?.graph_llm_provider ?? '—'
    const graphModel = preview?.graph_llm_model ?? '—'
    return (
      <div className="space-y-2">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold text-white">{entityCount}</span>
          <span className="text-gray-400 text-sm">entities</span>
          <Pill color={validationStatus === 'pass' ? 'green' : validationStatus === 'needs_review' ? 'amber' : 'gray'}>
            {validationStatus}
          </Pill>
        </div>
        <StatGrid items={[
          { label: 'Relations', value: relCount },
          { label: 'Membership', value: membershipCount },
          { label: 'Roles', value: roleCount },
          { label: 'Good-for', value: goodForCount },
          { label: 'Latency',   value: ms(stage?.latency_ms) },
          { label: 'Mode',      value: preview?.graph_extraction_mode ?? '—' },
        ]} />
        <ConfigBlock items={[
          { env: 'GRAPH_LLM_PROVIDER', value: graphProvider },
          { env: 'GRAPH_LLM_MODEL', value: graphModel },
          { env: 'GRAPH_EXTRACTOR_BACKEND', value: graphBackend },
          { env: 'GRAPH_SYSTEM_PROMPT', value: graphPromptOverridden ? 'env override' : 'default few-shot' },
          { env: 'GRAPH_PROMPT_SOURCE', value: graphPromptSource },
        ]} />
        {preview?.validation_summary && (
          <div className="bg-gray-800 rounded-lg px-2.5 py-2">
            <div className="text-[9px] text-gray-600 uppercase tracking-wider mb-1">Validation</div>
            <p className="text-[10px] text-gray-300">{preview.validation_summary}</p>
            {validationIssues.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {validationIssues.map(issue => (
                  <span key={issue} className="text-[9px] bg-amber-900/30 text-amber-300 px-1.5 py-0.5 rounded-full">{issue}</span>
                ))}
              </div>
            )}
            {needsMembershipHint && (
              <p className="mt-1 text-[10px] text-amber-200/90">
                Tip: if you want Graph to connect team members more strongly, add one natural sentence that states the team membership explicitly, or keep the team heading close to the member lines.
              </p>
            )}
          </div>
        )}
        {entityCount === 0 && (
          <div className="rounded-lg bg-gray-800 border border-gray-700 px-2.5 py-2 text-[10px] text-gray-500">
            No entities found — document may not contain named entities or graph extraction may be set to a non-LLM mode.
          </div>
        )}
        {entityCount > 0 && (
          <div className="bg-gray-800 rounded-lg px-2.5 py-2">
            <div className="text-[9px] text-gray-600 uppercase tracking-wider mb-1.5">Sample entities</div>
            <div className="flex flex-wrap gap-1">
              {preview!.graph_entities.slice(0, 6).map(e => (
                <span key={e.id} className="text-[9px] bg-gray-700 text-gray-300 px-1.5 py-0.5 rounded-full">{e.name}</span>
              ))}
              {entityCount > 6 && <span className="text-[9px] text-gray-600">+{entityCount - 6} more</span>}
            </div>
          </div>
        )}
        <ConfigBlock items={[
          { env: 'GRAPH_EXTRACTION_MODE', value: preview?.graph_extraction_mode ?? '—' },
        ]} />
      </div>
    )
  }

  if (nodeId === 'persist') {
    if (!isActive) return <p className="text-gray-500 text-[11px]">Stage not fired.</p>
    const plan = preview?.storage_plan ?? []
    const isDup = preview?.duplicate_detected
    const isDry = preview?.dry_run
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap gap-1.5 items-center">
          {isDry && <Pill color="amber">dry run</Pill>}
          {isDup ? <Pill color="red">⚠ duplicate</Pill> : <Pill color="green">✓ unique</Pill>}
          <span className="text-gray-500 text-[10px]">{plan.length} targets</span>
        </div>
        <StatGrid items={[
          { label: 'Latency', value: ms(stage?.latency_ms) },
          { label: 'Hash',    value: preview?.source_hash ? preview.source_hash.slice(0, 10) + '…' : '—' },
        ]} />
        {isDup && (
          <div className="rounded-lg bg-red-900/30 border border-red-700/50 px-2.5 py-2 text-[10px] text-red-300">
            Duplicate of <span className="font-mono">{preview?.duplicate_document_id?.slice(0, 16)}…</span>
          </div>
        )}
        {plan.length > 0 && (
          <div className="space-y-1">
            {plan.map(item => (
              <div key={item.target} className="bg-gray-800 rounded px-2.5 py-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] text-white font-medium">{item.target}</span>
                  <span className={`text-[9px] font-medium ${item.action === 'write' ? 'text-green-400' : item.action === 'skip' ? 'text-gray-500' : 'text-amber-400'}`}>{item.action}</span>
                </div>
                <p className="text-[9px] text-gray-500 mt-0.5">{item.reason}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return null
}

// ─── Pipeline Diagram ─────────────────────────────────────────────────────────

function PipelineDiagram({
  status, preview, selectedId, setSelectedId,
}: {
  status: PipelineStatus
  preview: IngestPreviewResult | null
  selectedId: string | null
  setSelectedId: (value: string | null) => void
}) {
  const diagramRef = useRef<HTMLDivElement | null>(null)
  const [popupStyle, setPopupStyle] = useState<React.CSSProperties | null>(null)
  const active = new Set(preview?.stages.filter((s) => s.fired).map((s) => s.stage))
  const vm = Object.fromEntries(NODES.map((n) => [n.id, n]))
  const edgeOn = (a: string, b: string) => status === 'done' && active.has(a) && active.has(b)

  useLayoutEffect(() => {
    if (!selectedId || !preview || typeof window === 'undefined') {
      setPopupStyle(null)
      return
    }

    const node = vm[selectedId]
    const container = diagramRef.current
    if (!node || !container) {
      setPopupStyle(null)
      return
    }

    const updatePosition = () => {
      const rect = container.getBoundingClientRect()
      const popupWidth = 256
      const estimatedHeight = 280
      const margin = 12
      const centerX = rect.left + ((node.x + node.w / 2) / VW) * rect.width
      const topY = rect.top + (node.y / VH) * rect.height
      const bottomY = rect.top + ((node.y + node.h) / VH) * rect.height
      const spaceAbove = topY - margin
      const spaceBelow = window.innerHeight - bottomY - margin
      const placeAbove = spaceBelow < estimatedHeight && spaceAbove > spaceBelow
      const popupHeight = placeAbove
        ? Math.max(160, Math.min(estimatedHeight, spaceAbove))
        : Math.max(160, Math.min(estimatedHeight, spaceBelow))
      const top = placeAbove
        ? Math.max(margin, topY - popupHeight - 8)
        : Math.min(window.innerHeight - margin - popupHeight, bottomY + 8)
      const left = centerX < rect.left + rect.width * 0.35
        ? Math.max(margin, Math.min(centerX, window.innerWidth - popupWidth - margin))
        : centerX > rect.left + rect.width * 0.65
          ? Math.max(margin, Math.min(centerX - popupWidth, window.innerWidth - popupWidth - margin))
          : Math.max(margin, Math.min(centerX - popupWidth / 2, window.innerWidth - popupWidth - margin))

      setPopupStyle({
        position: 'fixed',
        left,
        top,
        width: popupWidth,
        maxHeight: `min(${estimatedHeight}px, calc(100vh - 24px))`,
        overflowY: 'auto',
      })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [preview, selectedId])

  const bez = (a: string, b: string) => {
    const na = vm[a], nb = vm[b]
    if (!na || !nb) return ''
    const x1 = na.x + na.w, y1 = na.y + na.h / 2
    const x2 = nb.x, y2 = nb.y + nb.h / 2
    const mx = (x1 + x2) / 2
    return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`
  }

  const VW = 632, VH = 232

  return (
    <div>
      <div ref={diagramRef} className="relative w-full overflow-visible" style={{ aspectRatio: `${VW}/${VH}` }}>
        <svg viewBox={`0 0 ${VW} ${VH}`} className="absolute inset-0 w-full h-full" preserveAspectRatio="xMidYMid meet">
          <defs>
            <filter id="ingest-glow" x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="3.5" result="b" />
              <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <marker id="ingest-arr-active" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto">
              <path d="M0,0 L5,2.5 L0,5 Z" fill="#22c55e" />
            </marker>
            <marker id="ingest-arr-idle" markerWidth="4" markerHeight="4" refX="3" refY="2" orient="auto">
              <path d="M0,0 L4,2 L0,4 Z" fill="#1f2937" />
            </marker>
          </defs>

          {/* Section backgrounds */}
          <rect x={4}   y={76} width={184} height={72} rx={5} fill="#0f172a" opacity={0.6} />
          <rect x={196} y={76} width={216} height={72} rx={5} fill="#0f172a" opacity={0.4} />
          <rect x={420} y={76} width={208} height={72} rx={5} fill="#0f172a" opacity={0.4} />

          {/* Section labels */}
          {[
            { label: 'DOCUMENT PREP', x: 96 },
            { label: 'ENCODING',      x: 304 },
            { label: 'KNOWLEDGE & STORE', x: 524 },
          ].map(s => (
            <text key={s.label} x={s.x} y={71} textAnchor="middle" fill="#374151" fontSize={7} fontWeight={700} letterSpacing={0.7}>
              {s.label}
            </text>
          ))}

          {/* Edges */}
          {[['input', 'parse'], ['parse', 'chunk'], ['chunk', 'embed'], ['embed', 'graph'], ['graph', 'persist']].map(([a, b], idx) => {
            const on = edgeOn(a, b)
            const path = bez(a, b)
            const loading = status === 'loading'
            return (
              <g key={`${a}-${b}`}>
                <path
                  d={path}
                  fill="none"
                  stroke={on ? '#22c55e' : loading ? '#3b82f6' : '#1e293b'}
                  strokeWidth={on ? 2.5 : 1.25}
                  strokeDasharray={!on ? '4 3' : undefined}
                  markerEnd={on ? 'url(#ingest-arr-active)' : 'url(#ingest-arr-idle)'}
                />
                {on && <circle r={4.5} fill="#86efac" opacity={0.95}><animateMotion dur={`${0.9 + idx * 0.1}s`} repeatCount="indefinite" path={path} /></circle>}
                {loading && !on && <circle r={3} fill="#60a5fa" opacity={0.7}><animateMotion dur={`${1.15 + idx * 0.1}s`} repeatCount="indefinite" path={path} /></circle>}
              </g>
            )
          })}

          {/* Nodes */}
          {NODES.map((node) => {
            const on = status === 'done' && active.has(node.id)
            const opacity = on || status !== 'done' ? 1 : 0.4
            const isSelected = selectedId === node.id
            const timing = preview?.stages.find((s) => s.stage === node.id)?.latency_ms
            return (
              <g
                key={node.id}
                transform={`translate(${node.x},${node.y})`}
                opacity={opacity}
                onClick={() => setSelectedId(isSelected ? null : node.id)}
                style={{ cursor: 'pointer' }}
              >
                <title>{[node.label, timing != null ? `${timing.toFixed(0)}ms` : null].filter(Boolean).join(' · ')}</title>
                <rect
                  width={node.w} height={node.h} rx={5}
                  fill={on ? node.color : '#0f172a'}
                  stroke={on ? node.color : '#1e293b'}
                  strokeWidth={on ? 2 : 1}
                  filter={on ? 'url(#ingest-glow)' : undefined}
                />
                {/* Selected ring */}
                {isSelected && (
                  <rect x={-2} y={-2} width={node.w + 4} height={node.h + 4} rx={7} fill="none" stroke="white" strokeWidth={1.5} opacity={0.6} />
                )}
                {/* Icon */}
                <text x={5} y={11} textAnchor="start" fill={on ? 'rgba(255,255,255,0.7)' : '#2d3748'} fontSize={8}>{node.icon}</text>
                {/* Label + sublabel */}
                <text x={node.w / 2 + 4} y={node.sublabel ? 10 : 15} textAnchor="middle" fill={on ? 'white' : '#4b5563'} fontSize={9} fontWeight={on ? 700 : 400}>{node.label}</text>
                {node.sublabel && (
                  <text x={node.w / 2 + 4} y={21} textAnchor="middle" fill={on ? 'rgba(255,255,255,0.5)' : '#1e3a5f'} fontSize={7}>{node.sublabel}</text>
                )}
                {/* Timing badge */}
                {on && timing != null && (
                  <text x={node.w} y={0} textAnchor="end" fill="#fbbf24" fontSize={6.5} opacity={0.85}>{timing.toFixed(0)}ms</text>
                )}
              </g>
            )
          })}

          {/* Status text */}
          {status === 'loading' && <text x={VW / 2} y={VH - 3} textAnchor="middle" fill="#60a5fa" fontSize={8}>running ingest pipeline preview…</text>}
          {status === 'done' && <text x={VW / 2} y={VH - 3} textAnchor="middle" fill="#22c55e" fontSize={8}>preview complete · click nodes for details</text>}
        </svg>

        {/* Click-away backdrop */}
        {selectedId && (
          <div className="fixed inset-0 z-10" onClick={() => setSelectedId(null)} />
        )}

        {/* Floating popup */}
        {selectedId && preview && (() => {
          const node = vm[selectedId]
          if (!node) return null
          const stage = preview.stages.find((s) => s.stage === selectedId)
          const on = stage?.fired ?? false

          return (
            <div
              className="z-20 w-64 rounded-xl border shadow-2xl p-3 text-xs overflow-y-auto"
              style={{
                background: '#0c0c12',
                borderColor: '#2d2d3d',
                boxShadow: '0 8px 32px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04)',
                maxHeight: 'min(280px, calc(100vh - 24px))',
                transform:
                  node.x + node.w / 2 < VW * 0.35
                    ? 'translateX(0)'
                    : node.x + node.w / 2 > VW * 0.65
                      ? 'translateX(-100%)'
                      : 'translateX(-50%)',
                ...(popupStyle ?? {}),
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center gap-1.5 mb-2 pb-1.5 border-b border-gray-800">
                <span style={{ color: node.color }} className="text-sm leading-none">{node.icon}</span>
                <span className="font-semibold text-white text-[12px]">{node.label}</span>
                <div className="ml-auto flex items-center gap-1.5">
                  {status === 'loading' && <span className="text-violet-400 text-[9px] animate-pulse">running…</span>}
                  {status === 'done' && on  && <span className="text-[9px] text-green-500">✓ fired</span>}
                  {status === 'done' && !on && <span className="text-[9px] text-gray-600">skipped</span>}
                  <button onClick={() => setSelectedId(null)} className="ml-0.5 text-gray-600 hover:text-gray-300 text-base leading-none">×</button>
                </div>
              </div>
              {/* Body */}
              <div className="mb-2">
                {renderIngestNodeBody(selectedId, stage, preview, status)}
              </div>
              {/* Purpose footer */}
              <div className="pt-1.5 border-t border-gray-800">
                <p className="text-[9px] text-gray-600">{NODE_PURPOSE[selectedId]}</p>
              </div>
            </div>
          )
        })()}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-5 mt-1 text-[10px] text-gray-600">
        <span className="flex items-center gap-1.5">
          <span className="w-5 h-0.5 bg-green-500 inline-block rounded" />fired stage
        </span>
        <span className="flex items-center gap-1.5">
          <svg width={20} height={6}><line x1={0} y1={3} x2={20} y2={3} stroke="#1e293b" strokeDasharray="4 2" strokeWidth={1} /></svg>
          skipped / not called
        </span>
        <span className="text-gray-700 ml-auto">click node for details</span>
      </div>
    </div>
  )
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function filenameFromUrl(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl)
    const base = parsed.hostname.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '')
    return `${base || 'web-page'}.txt`
  } catch {
    return 'web-page.txt'
  }
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function IngestPreviewUI() {
  const [mode, setMode] = useState<Mode>('text')
  const [namespace, setNamespace] = useState('default')
  const [filename, setFilename] = useState('document.txt')
  const [sourceUrl, setSourceUrl] = useState('')
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [status, setStatus] = useState<PipelineStatus>('idle')
  const [preview, setPreview] = useState<IngestPreviewResult | null>(null)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function runPreview() {
    setError('')
    setLoadingPreview(true)
    setStatus('loading')
    try {
      let res: Response
      if (mode === 'text') {
        if (!text.trim()) { setError('Text is required'); setStatus('idle'); return }
        res = await fetch('/api/ingest-preview', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source: 'text', namespace, filename, url: sourceUrl || undefined, text, mime_type: 'text/plain' }),
        })
      } else if (mode === 'web') {
        if (!sourceUrl.trim()) { setError('Web URL is required'); setStatus('idle'); return }
        res = await fetch('/api/ingest-preview', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source: 'web', namespace, filename: filename.trim() || filenameFromUrl(sourceUrl.trim()), url: sourceUrl.trim(), mime_type: 'text/html' }),
        })
      } else {
        if (!file) { setError('Select a file first'); setStatus('idle'); return }
        const form = new FormData()
        form.append('source', 'file')
        form.append('namespace', namespace)
        form.append('filename', filename || file.name)
        if (sourceUrl.trim()) form.append('source_url', sourceUrl.trim())
        form.append('mime_type', file.type || 'application/octet-stream')
        form.append('file', file, file.name)
        res = await fetch('/api/ingest-preview', { method: 'POST', body: form })
      }

      const data = await res.json()
      if (!res.ok) {
        setError(data.detail ?? data.error ?? 'Preview failed')
        setPreview(null); setStatus('idle')
        return
      }
      setPreview(data as IngestPreviewResult)
      setStatus('done')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setPreview(null); setStatus('idle')
    } finally {
      setLoadingPreview(false)
    }
  }

  const activeStages = useMemo(
    () => new Set(preview?.stages.filter((s) => s.fired).map((s) => s.stage)),
    [preview],
  )

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <div className="shrink-0 border-b border-gray-800 px-6 py-3">
        <h1 className="text-base font-semibold text-white">Ingest Preview</h1>
        <p className="text-xs text-gray-500">Inspect the ingestion pipeline stage-by-stage. Click nodes in the diagram for detailed data.</p>
      </div>

      {/* All content below header */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col gap-3 px-4 pt-3 pb-4">

      {/* Input panel */}
      <div className="shrink-0">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 space-y-2.5">
          <div className="flex gap-2 items-end flex-wrap">
            <div className="w-40">
              <label className="block text-[10px] text-gray-500 mb-1 uppercase tracking-wider">Namespace</label>
              <input value={namespace} onChange={(e) => setNamespace(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-purple-500" />
            </div>
            <div className="w-44">
              <label className="block text-[10px] text-gray-500 mb-1 uppercase tracking-wider">Filename</label>
              <input value={filename} onChange={(e) => setFilename(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-purple-500" />
            </div>
            <div className="shrink-0 flex rounded-lg overflow-hidden border border-gray-700 text-xs font-medium self-end">
              {(['text', 'web', 'file'] as Mode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`px-3 py-1.5 transition-colors ${mode === m ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-500 hover:text-gray-300'} ${m !== 'text' ? 'border-l border-gray-700' : ''}`}
                >
                  {m === 'text' ? 'Text' : m === 'web' ? 'Web' : 'File'}
                </button>
              ))}
            </div>
            <button
              onClick={runPreview}
              disabled={loadingPreview}
              className={`shrink-0 px-5 py-1.5 disabled:opacity-50 text-white text-sm rounded-lg font-medium transition-colors self-end ${mode === 'web' ? 'bg-green-700 hover:bg-green-600' : 'bg-purple-600 hover:bg-purple-500'}`}
            >
              {loadingPreview ? 'Previewing…' : 'Run Preview'}
            </button>
            <button
              type="button"
              onClick={() => { setPreview(null); setError(''); setStatus('idle'); setSelectedId(null) }}
              className="shrink-0 px-3 py-1.5 text-sm rounded-lg font-medium transition-colors self-end bg-gray-800 text-gray-400 hover:text-white border border-gray-700"
            >
              Reset
            </button>
          </div>

          <div>
            {mode === 'text' && (
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={10}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-purple-500 resize-none font-mono text-xs"
                placeholder="Paste your document content here…"
              />
            )}
            {mode === 'web' && (
              <div>
                <input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-purple-500" placeholder="https://example.com/article" />
                <p className="mt-1 text-[10px] text-gray-500">Scrapes the page, then runs through the same ingest pipeline preview.</p>
              </div>
            )}
            {mode === 'file' && (
              <div>
                <div onClick={() => fileRef.current?.click()} className="border-2 border-dashed border-gray-700 hover:border-purple-600 rounded-lg p-4 text-center cursor-pointer transition-colors">
                  {file ? (
                    <div><p className="text-sm text-white font-medium">{file.name}</p><p className="text-xs text-gray-400 mt-1">{(file.size / 1024).toFixed(1)} KB</p></div>
                  ) : (
                    <><p className="text-sm text-gray-400">Click to select file</p><p className="text-xs text-gray-600 mt-1">PDF, TXT, DOCX, MD supported</p></>
                  )}
                </div>
                <input ref={fileRef} type="file" className="hidden" accept=".pdf,.txt,.md,.docx,.csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2 items-center min-h-[20px]">
            {preview ? (
              <>
                <Pill color={status === 'done' ? 'green' : status === 'loading' ? 'violet' : 'gray'}>{status}</Pill>
                {preview.dry_run && <Pill color="amber">dry run</Pill>}
                {preview.duplicate_detected && <Pill color="red">duplicate</Pill>}
                <span className="text-[10px] text-gray-500 ml-auto">{preview.namespace} · {preview.mime_type} · {preview.chunks.length} chunks · {preview.total_tokens?.toLocaleString()} tokens</span>
              </>
            ) : (
              <span className="text-[10px] text-gray-700">Select a source and run preview to inspect the pipeline.</span>
            )}
          </div>

          {error && <p className="text-xs text-red-400 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">{error}</p>}
        </div>
      </div>

      {/* Pipeline + Results */}
        <div className="flex-1 min-h-0 flex gap-3">

          {/* Left: Pipeline diagram */}
          <div className="flex-1 min-h-0 min-w-0 bg-gray-900 border border-gray-800 rounded-xl p-4 flex flex-col">
            <div className="flex items-center justify-between mb-3 shrink-0">
              <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Pipeline</span>
              {preview && (
                <span className="text-[10px] text-gray-500">
                  {preview.dry_run ? 'dry run' : 'live'} · {activeStages.size}/{STAGES.length} stages fired
                </span>
              )}
            </div>
            <div className="flex-1 min-h-0 flex flex-col justify-center">
              <PipelineDiagram status={status} preview={preview} selectedId={selectedId} setSelectedId={setSelectedId} />
            </div>
          </div>

          {/* Right: Results panel — only when there's a result */}
          {preview && (
            <div className="w-96 shrink-0 flex flex-col gap-3 overflow-y-auto">

              {/* ── Status badges ── */}
              <div className="shrink-0 flex flex-col gap-2">
                {preview.validation_status && (
                  <div className={`rounded-xl px-3 py-1.5 flex items-center gap-2 border ${preview.validation_status === 'pass' ? 'bg-emerald-900/20 border-emerald-700/40' : preview.validation_status === 'needs_review' ? 'bg-amber-900/20 border-amber-700/40' : 'bg-gray-900 border-gray-700'}`}>
                    <span className={`text-xs font-semibold ${preview.validation_status === 'pass' ? 'text-emerald-300' : preview.validation_status === 'needs_review' ? 'text-amber-300' : 'text-gray-400'}`}>
                      Graph {preview.validation_status}
                    </span>
                    {preview.validation_summary && (
                      <span className="text-[10px] text-gray-300 ml-auto">{preview.validation_summary}</span>
                    )}
                  </div>
                )}
                {preview.duplicate_detected && (
                  <div className="bg-red-900/25 border border-red-700/40 rounded-xl px-3 py-1.5 flex items-center gap-2">
                    <span className="text-red-300 text-xs font-semibold">⚠ Duplicate Detected</span>
                    <span className="text-[10px] text-red-500 ml-auto font-mono truncate">{preview.duplicate_document_id?.slice(0, 20)}…</span>
                  </div>
                )}
                {preview.dry_run && (
                  <div className="bg-amber-900/20 border border-amber-700/40 rounded-xl px-3 py-1.5 flex items-center gap-2">
                    <span className="text-amber-300 text-xs font-semibold">⚙ Dry Run</span>
                    <span className="text-[10px] text-amber-600 ml-auto">no data will be written</span>
                  </div>
                )}
                {preview.warnings.length > 0 && (
                  <div className="bg-orange-900/20 border border-orange-700/40 rounded-xl px-3 py-1.5 flex items-center gap-2">
                    <span className="text-orange-300 text-xs font-semibold">⚠ {preview.warnings.length} Warning{preview.warnings.length !== 1 ? 's' : ''}</span>
                    <span className="text-[10px] text-orange-600 ml-auto">{preview.warnings[0]}</span>
                  </div>
                )}
              </div>

              {/* ── Output summary ── */}
              <div className="shrink-0 bg-gray-900 border border-purple-800/40 rounded-xl p-3">
                <h3 className="text-[10px] font-semibold text-purple-400 uppercase tracking-wider mb-2">▣ Document Preview</h3>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500 mb-2">
                  <span><span className="text-gray-200 font-medium">{preview.chunk_count}</span> chunks</span>
                  <span><span className="text-gray-400 font-medium">{preview.total_tokens?.toLocaleString()}</span> tokens</span>
                  <span><span className="text-gray-400 font-medium">{(preview.parsed_chars / 1000).toFixed(1)}K</span> chars parsed</span>
                  {preview.graph_entities.length > 0 && (
                    <span><span className="text-emerald-400 font-medium">{preview.graph_entities.length}</span> entities</span>
                  )}
                  {preview.graph_relations.length > 0 && (
                    <span><span className="text-amber-400 font-medium">{preview.graph_relations.length}</span> relations</span>
                  )}
                </div>
                {preview.parsed_preview && (
                  <ExpandableText text={preview.parsed_preview} maxLen={320} />
                )}
              </div>

              {/* ── Stats ── */}
              <div className="shrink-0 bg-gray-900 border border-gray-800 rounded-xl p-3">
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500">
                  <span><span className="text-gray-300 font-medium">{preview.raw_chars?.toLocaleString()}</span> raw chars</span>
                  <span><span className="text-gray-300 font-medium">{preview.parsed_chars?.toLocaleString()}</span> parsed chars</span>
                  <span><span className="text-amber-400 font-medium">{preview.embedding_provider}</span> · {preview.embedding_model}</span>
                  <span><span className="text-blue-400 font-medium">{preview.chunker_strategy}</span> chunker</span>
                  {preview.graph_extraction_mode && (
                    <span><span className="text-emerald-400 font-medium">{preview.graph_extraction_mode}</span> graph mode</span>
                  )}
                  {preview.chunk_fallback_reason && (
                    <span className="w-full text-amber-500 truncate">⚠ fallback: {preview.chunk_fallback_reason}</span>
                  )}
                </div>
              </div>

              {/* ── Stage Timings ── */}
              {preview.stages.length > 0 && (
                <div className="shrink-0 bg-gray-900 border border-gray-800 rounded-xl p-3">
                  <h3 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Stage Timings</h3>
                  <table className="w-full text-[10px]">
                    <tbody>
                      {preview.stages.map((s) => (
                        <tr key={s.stage} className={s.fired ? '' : 'opacity-30'}>
                          <td className="py-0.5 pr-2 font-mono text-gray-500 capitalize">{s.stage}</td>
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
              )}

              {/* ── Chunks ── */}
              {preview.chunks.length > 0 && (
                <div className="shrink-0 bg-gray-900 border border-gray-800 rounded-xl p-3">
                  <h3 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
                    Chunks <span className="text-gray-700 normal-case font-normal">({preview.chunks.length})</span>
                  </h3>
                  <div className="flex flex-col gap-2">
                    {(() => {
                      const maxChars = Math.max(...preview.chunks.map(c => c.char_count), 1)
                      return preview.chunks.map((chunk, i) => (
                        <div key={chunk.chunk_id} className="border border-gray-800 rounded-lg p-2.5">
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="text-[10px] font-mono text-purple-400 shrink-0">#{i + 1}</span>
                              <span className="text-[9px] bg-gray-800 text-gray-500 px-1.5 py-0.5 rounded shrink-0">{chunk.chunk_type}</span>
                              <span className="text-[9px] text-gray-600 font-mono shrink-0">{chunk.embedding_dims}d</span>
                            </div>
                            <div className="w-20 shrink-0 ml-2 flex items-center gap-1.5">
                              <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden">
                                <div
                                  style={{ width: `${(chunk.char_count / maxChars) * 100}%`, background: '#a78bfa' }}
                                  className="h-full rounded-full transition-all"
                                />
                              </div>
                              <span className="text-[9px] font-mono text-gray-500 w-8 text-right shrink-0">{chunk.token_count}t</span>
                            </div>
                          </div>
                          <p className="text-[11px] text-gray-400 leading-relaxed line-clamp-3">{chunk.text_snippet}</p>
                        </div>
                      ))
                    })()}
                  </div>
                </div>
              )}

              {/* ── Graph Entities ── */}
              {preview.graph_entities.length > 0 && (
                <div className="shrink-0 bg-gray-900 border border-gray-800 rounded-xl p-3">
                  <h3 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
                    Graph Entities <span className="text-gray-700 normal-case font-normal">({preview.graph_entities.length})</span>
                  </h3>
                  {preview.validation_issues?.length ? (
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {preview.validation_issues.map(issue => (
                        <span key={issue} className="text-[9px] bg-amber-900/25 border border-amber-700/30 text-amber-300 px-2 py-0.5 rounded-full">
                          {issue}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <div className="flex flex-wrap gap-1.5">
                    {preview.graph_entities.map((e) => (
                      <span key={e.id} className="text-[10px] bg-emerald-600/20 border border-emerald-700/30 text-emerald-300 px-2 py-0.5 rounded-full">
                        {e.name} <span className="text-emerald-700">({e.label})</span>
                      </span>
                    ))}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-[9px] text-gray-500">
                    <span><span className="text-gray-400 font-medium">{(preview.graph_relations ?? []).filter(r => ['MEMBER_OF', 'PART_OF'].includes(r.relation_type)).length}</span> membership edges</span>
                    <span><span className="text-gray-400 font-medium">{preview.validation_status ?? 'unknown'}</span> validation</span>
                  </div>
                  {preview.graph_relations.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {preview.graph_relations.slice(0, 8).map((r) => (
                        <span key={r.id} className="text-[9px] bg-amber-900/20 border border-amber-700/30 text-amber-400 px-2 py-0.5 rounded-full">
                          {r.source_entity_id} → {r.target_entity_id}
                        </span>
                      ))}
                      {preview.graph_relations.length > 8 && (
                        <span className="text-[9px] text-gray-600">+{preview.graph_relations.length - 8} more</span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ── Storage Plan ── */}
              {preview.storage_plan.length > 0 && (
                <div className="shrink-0 bg-gray-900 border border-gray-800 rounded-xl p-3">
                  <h3 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Storage Plan</h3>
                  <div className="flex flex-col gap-1.5">
                    {preview.storage_plan.map((item) => (
                      <div key={item.target} className="border border-gray-800 rounded-lg p-2.5">
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-[11px] text-gray-300 font-medium">{item.target}</span>
                          <span className={`text-[10px] font-semibold ${item.action === 'write' ? 'text-green-400' : item.action === 'skip' ? 'text-gray-500' : 'text-amber-400'}`}>{item.action}</span>
                        </div>
                        <p className="text-[10px] text-gray-600">{item.reason}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Source Hash ── */}
              <div className="shrink-0 bg-gray-900 border border-gray-800 rounded-xl p-3">
                <h3 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Source Hash</h3>
                <p className="text-[10px] text-gray-400 font-mono break-all">{preview.source_hash || '—'}</p>
              </div>

            </div>
          )}
        </div>
      </div>
    </div>
  )
}
