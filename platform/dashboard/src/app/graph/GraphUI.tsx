'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import Tabs from '@/components/Tabs'

// ── Types ──────────────────────────────────────────────────────────────────
interface GraphStats {
  entity_count: number
  relation_count: number
  error?: string
}

interface EntityOut {
  id: string
  label: 'PERSON' | 'ORG' | 'LOCATION' | 'CONCEPT'
  name: string
  source_doc_ids: string[]
}

interface RelationOut {
  id: string
  source_entity_id: string
  target_entity_id: string
  relation_type: string
  source_doc_id: string
}

interface QueryResult {
  entities: EntityOut[]
  relations: RelationOut[]
  context_text: string
}

interface NamespaceSummary {
  namespace: string
  document_count: number
}

// ── Label config ───────────────────────────────────────────────────────────
const LABEL_STYLE: Record<EntityOut['label'], { color: string; bg: string; border: string }> = {
  PERSON:   { color: 'text-blue-400',   bg: 'bg-blue-900/20',   border: 'border-blue-700/40' },
  ORG:      { color: 'text-purple-400', bg: 'bg-purple-900/20', border: 'border-purple-700/40' },
  LOCATION: { color: 'text-green-400',  bg: 'bg-green-900/20',  border: 'border-green-700/40' },
  CONCEPT:  { color: 'text-amber-400',  bg: 'bg-amber-900/20',  border: 'border-amber-700/40' },
}

const NODE_COLOR: Record<string, string> = {
  PERSON:   '#3b82f6',
  ORG:      '#a855f7',
  LOCATION: '#22c55e',
  CONCEPT:  '#f59e0b',
}

function EntityBadge({ entity }: { entity: EntityOut }) {
  const s = LABEL_STYLE[entity.label] ?? LABEL_STYLE.CONCEPT
  return (
    <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${s.bg} ${s.border}`}>
      <span className={`text-[10px] font-semibold uppercase tracking-wider ${s.color}`}>{entity.label}</span>
      <span className="text-sm text-white font-medium">{entity.name}</span>
      {entity.source_doc_ids.length > 0 && (
        <span className="ml-auto text-xs text-gray-600 font-mono" title={entity.source_doc_ids.join(', ')}>
          {entity.source_doc_ids.length} doc{entity.source_doc_ids.length !== 1 ? 's' : ''}
        </span>
      )}
    </div>
  )
}

// ── Force Graph View ───────────────────────────────────────────────────────
interface FGNode { id: string; name: string; label: string; val?: number }
interface FGLink { source: string; target: string; label: string }

function ForceGraphView({ entities, relations }: { entities: EntityOut[]; relations: RelationOut[] }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [FG, setFG] = useState<React.ComponentType<any> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(600)
  const HEIGHT = 460

  useEffect(() => {
    // Lazy import to avoid SSR + AFRAME crash
    import('react-force-graph').then((m) => {
      // named export ForceGraph2D
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setFG(() => (m as any).ForceGraph2D ?? (m as any).default)
    }).catch(() => {
      // fallback: try 3D
      import('react-force-graph-3d').then((m) => setFG(() => m.default))
    })
  }, [])

  useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver(([entry]) => {
      setWidth(entry.contentRect.width || 600)
    })
    ro.observe(containerRef.current)
    setWidth(containerRef.current.getBoundingClientRect().width || 600)
    return () => ro.disconnect()
  }, [FG])

  const gData = useMemo<{ nodes: FGNode[]; links: FGLink[] }>(() => ({
    nodes: entities.map((e) => ({
      id: e.id,
      name: e.name,
      label: e.label,
      val: 1 + (relations.filter((r) => r.source_entity_id === e.id || r.target_entity_id === e.id).length * 0.4),
    })),
    links: relations.map((r) => ({
      source: r.source_entity_id,
      target: r.target_entity_id,
      label: r.relation_type,
    })),
  }), [entities, relations])

  if (!FG) {
    return (
      <div className="h-48 flex items-center justify-center text-gray-600 text-sm gap-2">
        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Loading graph renderer…
      </div>
    )
  }

  return (
    <div ref={containerRef} className="w-full rounded-xl overflow-hidden border border-gray-800">
      <FG
        graphData={gData}
        width={width}
        height={HEIGHT}
        backgroundColor="#030712"
        nodeLabel="name"
        nodeColor={(n: FGNode) => NODE_COLOR[n.label] ?? '#6b7280'}
        nodeVal="val"
        nodeRelSize={5}
        linkLabel="label"
        linkColor={() => '#374151'}
        linkWidth={1.5}
        linkDirectionalArrowLength={5}
        linkDirectionalArrowRelPos={1}
        linkCurvature={0.15}
        linkDirectionalParticles={1}
        linkDirectionalParticleSpeed={0.004}
        linkDirectionalParticleColor={() => '#6b7280'}
        nodeCanvasObject={(node: FGNode & { x?: number; y?: number }, ctx: CanvasRenderingContext2D, globalScale: number) => {
          const x = node.x ?? 0
          const y = node.y ?? 0
          const r = 5 + ((node.val ?? 1) - 1) * 1.5
          const col = NODE_COLOR[node.label] ?? '#6b7280'

          // glow ring
          ctx.beginPath()
          ctx.arc(x, y, r + 2, 0, 2 * Math.PI)
          ctx.fillStyle = col + '33'
          ctx.fill()

          // node circle
          ctx.beginPath()
          ctx.arc(x, y, r, 0, 2 * Math.PI)
          ctx.fillStyle = col
          ctx.fill()

          // label — only if zoomed in enough
          if (globalScale > 0.8) {
            const fontSize = Math.max(12 / globalScale, 3)
            ctx.font = `${fontSize}px ui-sans-serif, sans-serif`
            ctx.fillStyle = '#f3f4f6'
            ctx.textAlign = 'center'
            ctx.textBaseline = 'top'
            ctx.fillText(node.name, x, y + r + 2)
          }
        }}
        nodeCanvasObjectMode={() => 'replace'}
        cooldownTicks={80}
        onEngineStop={() => {/* settled */}}
      />
    </div>
  )
}

// ── Legend ─────────────────────────────────────────────────────────────────
function GraphLegend() {
  const items = [
    { label: 'PERSON',   color: 'bg-blue-500' },
    { label: 'ORG',      color: 'bg-purple-500' },
    { label: 'LOCATION', color: 'bg-green-500' },
    { label: 'CONCEPT',  color: 'bg-amber-500' },
  ]
  return (
    <div className="flex items-center gap-4 flex-wrap">
      {items.map((i) => (
        <div key={i.label} className="flex items-center gap-1.5">
          <span className={`w-2.5 h-2.5 rounded-full ${i.color}`} />
          <span className="text-[10px] text-gray-500">{i.label}</span>
        </div>
      ))}
      <span className="text-[10px] text-gray-600 ml-2">· scroll to zoom · drag to pan · click+drag node</span>
    </div>
  )
}

const GRAPH_TABS = [
  { id: 'explorer', label: 'Explorer' },
  { id: 'extract', label: 'Entity Extractor' },
  { id: 'namespaces', label: 'Namespaces' },
]

// ── Main component ─────────────────────────────────────────────────────────
export default function GraphUI() {
  const [activeTab, setActiveTab] = useState('explorer')

  // Stats
  const [stats, setStats] = useState<GraphStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(true)
  const [serviceUp, setServiceUp] = useState<boolean | null>(null)

  // Explorer
  const [queryText, setQueryText] = useState('')
  const [maxHops, setMaxHops] = useState(2)
  const [queryNs, setQueryNs] = useState('default')
  const [querying, setQuerying] = useState(false)
  const [result, setResult] = useState<QueryResult | null>(null)
  const [queryError, setQueryError] = useState('')
  const [viewMode, setViewMode] = useState<'graph' | 'list'>('graph')

  // Namespaces
  const [namespaces, setNamespaces] = useState<NamespaceSummary[]>([])
  const [deletingNs, setDeletingNs] = useState<string | null>(null)
  const [nsMsg, setNsMsg] = useState('')
  const [nsError, setNsError] = useState('')

  // Extract preview
  const [extractText, setExtractText] = useState('')
  const [extractNs, setExtractNs] = useState('default')
  const [extracting, setExtracting] = useState(false)
  const [extractResult, setExtractResult] = useState<{ entities: EntityOut[]; relations: RelationOut[] } | null>(null)
  const [extractError, setExtractError] = useState('')

  const loadStats = useCallback(async () => {
    setStatsLoading(true)
    try {
      const res = await fetch('/api/graph/stats', { cache: 'no-store' })
      const data = await res.json()
      setServiceUp(!data.error && res.ok)
      setStats(data)
    } catch {
      setServiceUp(false)
      setStats(null)
    } finally {
      setStatsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadStats()
    fetch('/api/namespaces')
      .then((r) => r.json())
      .then((data) => setNamespaces(Array.isArray(data) ? data : []))
      .catch(() => setNamespaces([]))
  }, [loadStats])

  async function runQuery() {
    if (!queryText.trim()) return
    setQuerying(true)
    setQueryError('')
    setResult(null)
    try {
      const res = await fetch('/api/graph/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query_text: queryText.trim(),
          entity_names: [],
          max_hops: maxHops,
          namespace: queryNs,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
      setResult(data)
    } catch (e: unknown) {
      setQueryError(e instanceof Error ? e.message : 'Query failed')
    } finally {
      setQuerying(false)
    }
  }

  async function runExtract() {
    if (!extractText.trim()) return
    setExtracting(true)
    setExtractError('')
    setExtractResult(null)
    try {
      const res = await fetch('/api/graph/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: extractText.trim(), namespace: extractNs }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
      setExtractResult(data)
    } catch (e: unknown) {
      setExtractError(e instanceof Error ? e.message : 'Extract failed')
    } finally {
      setExtracting(false)
    }
  }

  async function deleteNamespaceGraph(ns: string) {
    if (!confirm(`Delete all graph data for namespace "${ns}"? Vector data is NOT affected.`)) return
    setDeletingNs(ns)
    setNsMsg('')
    setNsError('')
    try {
      const res = await fetch(`/api/graph/namespaces/${encodeURIComponent(ns)}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
      setNsMsg(`Graph data deleted for "${ns}"`)
      loadStats()
    } catch (e: unknown) {
      setNsError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setDeletingNs(null)
    }
  }

  // Build entity lookup for relation display
  const entityMap = Object.fromEntries((result?.entities ?? []).map((e) => [e.id, e]))

  // Group entities by label
  const grouped = (result?.entities ?? []).reduce<Partial<Record<EntityOut['label'], EntityOut[]>>>((acc, e) => {
    acc[e.label] = [...(acc[e.label] ?? []), e]
    return acc
  }, {})

  return (
    <div className="flex flex-col h-screen bg-gray-950">

      {/* ── Header ── */}
      <div className="shrink-0 px-6 pt-6 pb-4 border-b border-gray-800">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Graph Knowledge</h1>
            <p className="text-sm text-gray-400 mt-1">
              Neo4j entity graph — explore relationships extracted from ingested documents
            </p>
          </div>
          <button
            onClick={loadStats}
            className="text-xs text-gray-400 hover:text-white px-3 py-1.5 rounded-lg border border-gray-700 hover:border-gray-500 transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* ── Stats ── */}
      <div className="shrink-0 px-6 py-4 grid grid-cols-3 gap-4 border-b border-gray-800">
        <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-4">
          <p className="text-xs text-gray-400 mb-1">Entities</p>
          <p className="text-2xl font-bold text-white">
            {statsLoading ? '—' : (stats?.entity_count ?? 0).toLocaleString()}
          </p>
        </div>
        <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-4">
          <p className="text-xs text-gray-400 mb-1">Relations</p>
          <p className="text-2xl font-bold text-blue-400">
            {statsLoading ? '—' : (stats?.relation_count ?? 0).toLocaleString()}
          </p>
        </div>
        <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-4">
          <p className="text-xs text-gray-400 mb-1">Service Status</p>
          <div className="flex items-center gap-2 mt-1">
            <span className={`w-2 h-2 rounded-full ${
              serviceUp === null ? 'bg-gray-500 animate-pulse'
              : serviceUp ? 'bg-green-400'
              : 'bg-red-400'
            }`} />
            <span className={`text-sm font-medium ${
              serviceUp === null ? 'text-gray-500'
              : serviceUp ? 'text-green-400'
              : 'text-red-400'
            }`}>
              {serviceUp === null ? 'Checking…' : serviceUp ? 'Online' : 'Offline'}
            </span>
          </div>
        </div>
      </div>

      {/* ── Tabs bar ── */}
      <div className="shrink-0 px-6">
        <Tabs tabs={GRAPH_TABS} active={activeTab} onChange={setActiveTab} />
      </div>

      {/* ── Tab description ── */}
      {activeTab === 'explorer' && (
        <div className="shrink-0 px-6 pt-3 pb-1">
          <div className="rounded-lg bg-purple-900/10 border border-purple-800/30 px-4 py-2.5 flex items-start gap-2">
            <svg className="w-3.5 h-3.5 text-purple-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <p className="text-xs text-gray-400">
              <span className="text-purple-300 font-medium">Explorer</span> — ค้นหา entities และ relationships ที่เก็บไว้ใน Neo4j จาก documents ที่ ingest แล้ว
              ใส่คำค้นหาแล้วระบบจะ traverse graph เพื่อหา entities ที่เกี่ยวข้องภายใน max hops ที่กำหนด
            </p>
          </div>
        </div>
      )}
      {activeTab === 'extract' && (
        <div className="shrink-0 px-6 pt-3 pb-1">
          <div className="rounded-lg bg-amber-900/10 border border-amber-800/30 px-4 py-2.5 flex items-start gap-2">
            <svg className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            <p className="text-xs text-gray-400">
              <span className="text-amber-300 font-medium">Entity Extractor</span> — ทดสอบ preview ว่าถ้านำ text นี้ไป ingest จะได้ entities & relations อะไรบ้าง
              ใช้ spaCy NER + dependency parsing — <span className="text-amber-500">dry-run เท่านั้น ไม่มีการบันทึกข้อมูลลง graph จริง</span>
            </p>
          </div>
        </div>
      )}
      {activeTab === 'namespaces' && (
        <div className="shrink-0 px-6 pt-3 pb-1">
          <div className="rounded-lg bg-red-900/10 border border-red-800/30 px-4 py-2.5 flex items-start gap-2">
            <svg className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            <p className="text-xs text-gray-400">
              <span className="text-red-300 font-medium">Namespaces</span> — ลบ graph data (entities & relations) ทั้งหมดของ namespace ใดๆ
              ข้อมูล vector ใน ChromaDB จะ<span className="text-gray-300"> ไม่ถูกลบ</span> — ใช้หน้า Documents สำหรับลบ document จาก vector store
            </p>
          </div>
        </div>
      )}

      {/* ── Tab content ── */}
      <div className="flex-1 overflow-y-auto px-6 py-5">

        {/* Explorer tab */}
        {activeTab === 'explorer' && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-5 space-y-4">
              {/* Controls row */}
              <div className="flex gap-3 flex-wrap">
                {/* Namespace */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">Namespace</span>
                  <select
                    value={queryNs}
                    onChange={(e) => setQueryNs(e.target.value)}
                    className="bg-gray-800 border border-gray-700 focus:border-purple-500 rounded-lg px-3 py-1.5 text-xs text-white outline-none transition-colors"
                  >
                    {namespaces.length === 0
                      ? <option value="default">default</option>
                      : namespaces.map((ns) => (
                          <option key={ns.namespace} value={ns.namespace}>{ns.namespace}</option>
                        ))
                    }
                  </select>
                </div>
                {/* Max hops */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">Max hops</span>
                  <div className="flex gap-1">
                    {[1, 2, 3].map((h) => (
                      <button
                        key={h}
                        onClick={() => setMaxHops(h)}
                        className={`w-8 h-7 rounded-lg text-xs font-medium transition-colors ${
                          maxHops === h
                            ? 'bg-purple-600 text-white'
                            : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                        }`}
                      >
                        {h}
                      </button>
                    ))}
                  </div>
                </div>
                {/* View mode toggle — only when there are results */}
                {result && result.entities.length > 0 && (
                  <div className="ml-auto flex rounded-lg overflow-hidden border border-gray-700 text-xs">
                    <button
                      onClick={() => setViewMode('graph')}
                      className={`px-3 py-1.5 transition-colors ${viewMode === 'graph' ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
                    >
                      ⬡ Graph
                    </button>
                    <button
                      onClick={() => setViewMode('list')}
                      className={`px-3 py-1.5 transition-colors ${viewMode === 'list' ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
                    >
                      ☰ List
                    </button>
                  </div>
                )}
              </div>

              {/* Query input */}
              <div className="flex gap-3">
                <textarea
                  value={queryText}
                  onChange={(e) => setQueryText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) runQuery() }}
                  placeholder="Enter a query or topic to explore related entities…"
                  rows={2}
                  className="flex-1 bg-gray-950 border border-gray-700 focus:border-purple-500 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 outline-none resize-none transition-colors"
                />
                <button
                  onClick={runQuery}
                  disabled={querying || !queryText.trim()}
                  className="px-5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                >
                  {querying ? (
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  ) : 'Query'}
                </button>
              </div>
              <p className="text-xs text-gray-600">Tip: ⌘+Enter to run</p>
            </div>

            {/* Query error */}
            {queryError && (
              <div className="rounded-xl border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-400">
                {queryError}
              </div>
            )}

            {/* Results */}
            {result && (
              <div className="space-y-4">
                {/* Summary bar */}
                <div className="flex items-center gap-3 text-xs text-gray-500">
                  <span className="text-white font-medium">{result.entities.length}</span> entities
                  <span>·</span>
                  <span className="text-white font-medium">{result.relations.length}</span> relations
                  <span>·</span>
                  <span>{maxHops} hop{maxHops !== 1 ? 's' : ''}</span>
                  <span>·</span>
                  <span className="font-mono text-gray-600">{queryNs}</span>
                </div>

                {result.entities.length === 0 ? (
                  <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-8 text-center">
                    <svg className="w-8 h-8 mx-auto mb-2 text-gray-600 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p className="text-sm text-gray-500">No entities found — try a different query or namespace</p>
                  </div>
                ) : viewMode === 'graph' ? (
                  <div className="space-y-2">
                    <GraphLegend />
                    <ForceGraphView entities={result.entities} relations={result.relations} />
                  </div>
                ) : (
                  <div className="grid md:grid-cols-2 gap-4">
                    {/* Entities by type */}
                    <div className="space-y-3">
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Entities</p>
                      {(Object.entries(grouped) as [EntityOut['label'], EntityOut[]][]).map(([label, items]) => (
                        <div key={label} className="space-y-1.5">
                          <p className={`text-[10px] font-semibold uppercase tracking-wider ${LABEL_STYLE[label]?.color ?? 'text-gray-400'}`}>
                            {label} ({items.length})
                          </p>
                          {items.map((e) => <EntityBadge key={e.id} entity={e} />)}
                        </div>
                      ))}
                    </div>

                    {/* Relations */}
                    <div className="space-y-3">
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Relations</p>
                      {result.relations.length === 0 ? (
                        <p className="text-xs text-gray-600">No relations found</p>
                      ) : (
                        <div className="rounded-xl border border-gray-800 bg-gray-900/50 divide-y divide-gray-800 overflow-hidden">
                          {result.relations.map((r) => {
                            const src = entityMap[r.source_entity_id]
                            const tgt = entityMap[r.target_entity_id]
                            return (
                              <div key={r.id} className="px-3 py-2.5 flex items-center gap-2 text-xs">
                                <span className={`font-medium ${LABEL_STYLE[src?.label ?? 'CONCEPT']?.color ?? 'text-gray-300'}`}>
                                  {src?.name ?? r.source_entity_id.slice(0, 8)}
                                </span>
                                <span className="text-gray-600 shrink-0">
                                  —[<span className="text-gray-400 font-mono">{r.relation_type}</span>]→
                                </span>
                                <span className={`font-medium ${LABEL_STYLE[tgt?.label ?? 'CONCEPT']?.color ?? 'text-gray-300'}`}>
                                  {tgt?.name ?? r.target_entity_id.slice(0, 8)}
                                </span>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Context text (collapsed) */}
                {result.context_text && (
                  <details className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden">
                    <summary className="px-4 py-2.5 text-xs text-gray-500 cursor-pointer hover:text-gray-300 transition-colors select-none">
                      Raw context injected into LLM ({result.context_text.split('\n').length} lines)
                    </summary>
                    <pre className="px-4 pb-4 text-xs text-gray-400 leading-relaxed whitespace-pre-wrap font-mono max-h-64 overflow-y-auto">
                      {result.context_text}
                    </pre>
                  </details>
                )}
              </div>
            )}
          </div>
        )}

        {/* Entity Extractor tab */}
        {activeTab === 'extract' && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-5 space-y-4">
              {/* Namespace + Sample presets row */}
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">Namespace</span>
                  <select
                    value={extractNs}
                    onChange={(e) => setExtractNs(e.target.value)}
                    className="bg-gray-800 border border-gray-700 focus:border-purple-500 rounded-lg px-3 py-1.5 text-xs text-white outline-none transition-colors"
                  >
                    {namespaces.length === 0
                      ? <option value="default">default</option>
                      : namespaces.map((ns) => (
                          <option key={ns.namespace} value={ns.namespace}>{ns.namespace}</option>
                        ))
                    }
                  </select>
                </div>
                {/* Sample presets */}
                <div className="flex flex-wrap gap-1.5">
                  <span className="text-[10px] text-gray-600 self-center">Samples:</span>
                  {[
                    { label: 'Person + Org', text: 'Narin Sutham leads the finance team at ACME Corp. Ploy Anan reports to Narin and manages operations in Bangkok.' },
                    { label: 'Event', text: 'Google acquired DeepMind in 2014. Sundar Pichai announced the deal in London, where DeepMind was founded by Demis Hassabis.' },
                    { label: 'Tech', text: 'OpenAI developed GPT-4 which powers ChatGPT. Sam Altman is the CEO of OpenAI and previously worked at Y Combinator in San Francisco.' },
                  ].map((s) => (
                    <button
                      key={s.label}
                      onClick={() => setExtractText(s.text)}
                      className="text-[10px] px-2 py-1 rounded bg-gray-800 border border-gray-700 text-gray-400 hover:border-amber-700/50 hover:text-amber-400 transition-colors"
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-3">
                <textarea
                  value={extractText}
                  onChange={(e) => setExtractText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) runExtract() }}
                  placeholder="Paste a paragraph of text — full sentences work best, e.g. Narin leads the team at ACME Corp"
                  rows={4}
                  className="flex-1 bg-gray-950 border border-gray-700 focus:border-purple-500 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 outline-none resize-none transition-colors"
                />
                <button
                  onClick={runExtract}
                  disabled={extracting || !extractText.trim()}
                  className="px-5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                >
                  {extracting ? (
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  ) : 'Extract'}
                </button>
              </div>
              <p className="text-xs text-gray-600">⌘+Enter to run · preview only, nothing saved · ใช้ประโยคเต็ม + ชื่อขึ้นต้นตัวพิมพ์ใหญ่จะให้ผลดีที่สุด</p>
            </div>

            {extractError && (
              <div className="rounded-xl border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-400">{extractError}</div>
            )}

            {extractResult && (
              <div className="space-y-3">
                <div className="flex items-center gap-3 text-xs text-gray-500">
                  <span className="text-white font-medium">{extractResult.entities.length}</span> entities
                  <span>·</span>
                  <span className="text-white font-medium">{extractResult.relations.length}</span> relations
                  <span className="ml-auto text-gray-600 italic">preview only</span>
                </div>
                {extractResult.entities.length === 0 ? (
                  <div className="rounded-xl border border-gray-800 bg-gray-900/50 px-4 py-5 space-y-2">
                    <p className="text-sm text-gray-400">ไม่พบ entities ในข้อความนี้</p>
                    <div className="text-xs text-gray-600 space-y-1">
                      <p>spaCy NER ต้องการ:</p>
                      <ul className="list-disc list-inside space-y-0.5 pl-1">
                        <li>ประโยคเต็มที่มี verb เช่น <span className="text-gray-400 font-mono">&quot;Narin <u>works at</u> ACME&quot;</span></li>
                        <li>ชื่อ/องค์กรขึ้นต้นด้วยตัวพิมพ์ใหญ่ เช่น <span className="text-gray-400 font-mono">Narin</span> ไม่ใช่ <span className="text-gray-400 font-mono">narin</span></li>
                        <li>ข้อความภาษาอังกฤษ (model: en_core_web_sm)</li>
                      </ul>
                      <p className="mt-2">ลองกด sample preset ด้านบนเพื่อดูตัวอย่างที่ใช้งานได้</p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {extractResult.entities.length > 1 && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Graph Preview</p>
                          <GraphLegend />
                        </div>
                        <ForceGraphView entities={extractResult.entities} relations={extractResult.relations} />
                      </div>
                    )}
                    <div className="grid md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Entities</p>
                        {extractResult.entities.map((e) => <EntityBadge key={e.id} entity={e} />)}
                      </div>
                      {extractResult.relations.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Relations</p>
                          <div className="rounded-xl border border-gray-800 bg-gray-900/50 divide-y divide-gray-800 overflow-hidden">
                            {extractResult.relations.map((r) => {
                              const src = extractResult.entities.find((e) => e.id === r.source_entity_id)
                              const tgt = extractResult.entities.find((e) => e.id === r.target_entity_id)
                              return (
                                <div key={r.id} className="px-3 py-2.5 flex items-center gap-2 text-xs">
                                  <span className={`font-medium ${LABEL_STYLE[src?.label ?? 'CONCEPT']?.color ?? 'text-gray-300'}`}>
                                    {src?.name ?? r.source_entity_id.slice(0, 8)}
                                  </span>
                                  <span className="text-gray-600 shrink-0">
                                    —[<span className="text-gray-400 font-mono">{r.relation_type}</span>]→
                                  </span>
                                  <span className={`font-medium ${LABEL_STYLE[tgt?.label ?? 'CONCEPT']?.color ?? 'text-gray-300'}`}>
                                    {tgt?.name ?? r.target_entity_id.slice(0, 8)}
                                  </span>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Namespaces tab */}
        {activeTab === 'namespaces' && (
          <div className="space-y-3">
            <div>
              <p className="text-xs text-gray-500">
                Delete graph entities and relations for a namespace — vector data is not affected
              </p>
            </div>

            {nsMsg && (
              <div className="rounded-xl border border-green-800 bg-green-900/20 px-4 py-3 text-sm text-green-400">{nsMsg}</div>
            )}
            {nsError && (
              <div className="rounded-xl border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-400">{nsError}</div>
            )}

            {namespaces.length === 0 ? (
              <div className="rounded-xl border border-gray-800 bg-gray-900/50 px-4 py-6 text-center text-sm text-gray-600">
                No namespaces found
              </div>
            ) : (
              <div className="rounded-2xl border border-gray-800 bg-gray-900/70 divide-y divide-gray-800 overflow-hidden">
                {namespaces.map((ns) => (
                  <div key={ns.namespace} className="flex items-center justify-between px-5 py-3">
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-sm text-white">{ns.namespace}</span>
                      <span className="text-xs text-gray-600">{ns.document_count} docs in vector store</span>
                    </div>
                    <button
                      onClick={() => deleteNamespaceGraph(ns.namespace)}
                      disabled={deletingNs === ns.namespace}
                      className="text-xs px-3 py-1.5 rounded-lg bg-red-900/40 hover:bg-red-800/60 text-red-300 border border-red-800/40 transition-colors disabled:opacity-40"
                    >
                      {deletingNs === ns.namespace ? 'Deleting…' : 'Delete graph data'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  )
}
