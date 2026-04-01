'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import Tabs from '@/components/Tabs'

interface MemoryUser {
  user_id: string
  entry_count: number
  last_updated: string | null
}

interface MetricsSummary {
  query_volume_total: number
  avg_retrieval_latency_ms: number
  avg_answer_latency_ms: number
  avg_total_latency_ms: number
  error_rate: number
  cache_hit_rate: number
  document_count: number
  chunk_count: number
  pending_approvals: number
  avg_grounding_score: number
  knowledge_gaps_24h: number
}

interface EvaluationSummary {
  faithfulness: number | null
  answer_relevance: number | null
  context_precision: number | null
  context_recall: number | null
  sample_count: number
}

interface NamespaceSummary {
  namespace: string
  document_count: number
  chunk_count: number
  description?: string
  entity_count?: number
  relation_count?: number
  has_vector?: boolean
  has_graph?: boolean
}

interface ReportData {
  users: MemoryUser[]
  metrics: MetricsSummary | null
  evaluation: EvaluationSummary | null
  namespaces: NamespaceSummary[]
}

function formatDate(s: string | null) {
  if (!s) return '—'
  try { return new Date(s).toLocaleString() } catch { return s }
}

function pct(v: number | null | undefined) {
  if (v == null) return '—'
  return `${Math.round(v * 100)}%`
}

function ms(v: number | null | undefined) {
  if (v == null) return '—'
  return `${Math.round(v)} ms`
}

function ScoreChip({ value }: { value: number | null }) {
  if (value == null) return <span className="text-gray-600 text-xs font-mono">—</span>
  const p = Math.round(value * 100)
  const color = p >= 80 ? 'text-green-400' : p >= 50 ? 'text-yellow-400' : 'text-red-400'
  return <span className={`text-lg font-bold font-mono ${color}`}>{p}%</span>
}

function exportJson(data: ReportData) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `rag-report-${new Date().toISOString().slice(0, 10)}.json`; a.click()
  URL.revokeObjectURL(url)
}

export default function ReportUI() {
  const [data, setData] = useState<ReportData>({ users: [], metrics: null, evaluation: null, namespaces: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState('performance')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/report')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData(await res.json())
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const { metrics: m, evaluation: ev, users, namespaces } = data

  const tabs = [
    { id: 'performance', label: 'Performance' },
    { id: 'knowledge', label: 'Knowledge Base' },
    { id: 'quality', label: 'Answer Quality' },
    { id: 'users', label: 'Memory Profiles' },
  ]

  return (
    <div className="flex flex-col h-screen bg-gray-950">
      {/* Header */}
      <div className="shrink-0 px-6 pt-6 pb-4 border-b border-gray-800 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">System Report</h1>
          <p className="text-sm text-gray-400 mt-1">Aggregate KPIs — query volume, latency, quality, and knowledge base health</p>
        </div>
        <div className="flex gap-2">
          {!loading && (
            <button
              onClick={() => exportJson(data)}
              className="text-xs text-gray-400 hover:text-white px-3 py-1.5 rounded-lg border border-gray-700 hover:border-gray-500 transition-colors"
            >
              Export JSON
            </button>
          )}
          <button onClick={load} className="text-xs text-gray-400 hover:text-white px-3 py-1.5 rounded-lg border border-gray-700 hover:border-gray-500 transition-colors">
            Refresh
          </button>
        </div>
      </div>

      {/* Tabs bar */}
      <div className="shrink-0 px-6">
        <Tabs tabs={tabs} active={activeTab} onChange={setActiveTab} />
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

        {activeTab === 'performance' && (
          <section className="space-y-4">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Query &amp; Performance</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-4">
                <p className="text-xs text-gray-400 mb-1">Total Queries</p>
                <p className="text-2xl font-bold text-white">{loading ? '—' : (m?.query_volume_total ?? '—').toLocaleString()}</p>
              </div>
              <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-4">
                <p className="text-xs text-gray-400 mb-1">Error Rate</p>
                <p className={`text-2xl font-bold ${!m ? 'text-gray-600' : m.error_rate > 0.05 ? 'text-red-400' : m.error_rate > 0.01 ? 'text-yellow-400' : 'text-green-400'}`}>
                  {loading ? '—' : pct(m?.error_rate)}
                </p>
              </div>
              <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-4">
                <p className="text-xs text-gray-400 mb-1">Cache Hit Rate</p>
                <p className={`text-2xl font-bold ${!m ? 'text-gray-600' : m.cache_hit_rate >= 0.4 ? 'text-green-400' : 'text-yellow-400'}`}>
                  {loading ? '—' : pct(m?.cache_hit_rate)}
                </p>
              </div>
              <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-4">
                <p className="text-xs text-gray-400 mb-1">Avg Grounding</p>
                <p className={`text-2xl font-bold ${!m ? 'text-gray-600' : (m.avg_grounding_score ?? 0) >= 0.8 ? 'text-green-400' : 'text-yellow-400'}`}>
                  {loading ? '—' : pct(m?.avg_grounding_score)}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-4">
                <p className="text-xs text-gray-400 mb-1">Retrieval Latency (avg)</p>
                <p className="text-xl font-bold text-blue-400">{loading ? '—' : ms(m?.avg_retrieval_latency_ms)}</p>
              </div>
              <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-4">
                <p className="text-xs text-gray-400 mb-1">Generation Latency (avg)</p>
                <p className="text-xl font-bold text-blue-400">{loading ? '—' : ms(m?.avg_answer_latency_ms)}</p>
              </div>
              <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-4">
                <p className="text-xs text-gray-400 mb-1">Total Latency (avg)</p>
                <p className="text-xl font-bold text-blue-400">{loading ? '—' : ms(m?.avg_total_latency_ms)}</p>
              </div>
            </div>
          </section>
        )}

        {activeTab === 'knowledge' && (
          <section className="space-y-6">
            {/* Summary cards */}
            <div>
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Knowledge Base — Overview</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-4">
                  <p className="text-xs text-gray-400 mb-1">Total Documents</p>
                  <p className="text-2xl font-bold text-white">{loading ? '—' : (m?.document_count ?? '—').toLocaleString()}</p>
                </div>
                <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-4">
                  <p className="text-xs text-gray-400 mb-1">Total Chunks</p>
                  <p className="text-2xl font-bold text-white">{loading ? '—' : (m?.chunk_count ?? '—').toLocaleString()}</p>
                </div>
                <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-4">
                  <p className="text-xs text-gray-400 mb-1">Namespaces</p>
                  <p className="text-2xl font-bold text-purple-300">{loading ? '—' : namespaces.length}</p>
                </div>
                <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-4">
                  <p className="text-xs text-gray-400 mb-1">Pending Approvals</p>
                  <p className={`text-2xl font-bold ${!m ? 'text-gray-600' : (m.pending_approvals ?? 0) > 0 ? 'text-yellow-400' : 'text-green-400'}`}>
                    {loading ? '—' : m?.pending_approvals ?? '—'}
                  </p>
                </div>
              </div>
            </div>

            {/* Per-namespace breakdown */}
            <div>
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">By Namespace</h2>
              {loading ? (
                <div className="space-y-2">
                  {[...Array(3)].map((_, i) => <div key={i} className="h-12 bg-gray-800/40 rounded-xl animate-pulse" />)}
                </div>
              ) : namespaces.length === 0 ? (
                <div className="bg-gray-800/40 border border-gray-700/50 rounded-xl p-6 text-center text-sm text-gray-500">
                  No namespace data available
                </div>
              ) : (
                <div className="overflow-hidden rounded-xl border border-gray-800">
                  {/* Bar chart backdrop */}
                  {(() => {
                    const maxDocs = Math.max(...namespaces.map(n => n.document_count), 1)
                    return (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-800 bg-gray-900/60">
                            <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider w-36">Namespace</th>
                            <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Description</th>
                            <th className="px-4 py-2.5 text-center text-xs font-semibold text-blue-400/70 uppercase tracking-wider w-32">Vector</th>
                            <th className="px-4 py-2.5 text-center text-xs font-semibold text-emerald-400/70 uppercase tracking-wider w-32">Graph</th>
                            <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider w-36">Share</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-800/60">
                          {[...namespaces].sort((a, b) => b.document_count - a.document_count).map(ns => {
                            const pct = maxDocs > 0 ? (ns.document_count / maxDocs) * 100 : 0
                            return (
                              <tr key={ns.namespace} className="bg-gray-900/20 hover:bg-gray-800/30 transition-colors">
                                <td className="px-4 py-3">
                                  <span className="font-mono text-sm text-purple-300">{ns.namespace}</span>
                                </td>
                                <td className="px-4 py-3 text-xs text-gray-500">
                                  {ns.description ?? <span className="text-gray-700 italic">—</span>}
                                </td>
                                <td className="px-4 py-3 text-center">
                                  {ns.has_vector !== false ? (
                                    <div>
                                      <span className="text-xs text-blue-400 font-medium">{ns.document_count.toLocaleString()} docs</span>
                                      <div className="text-[10px] text-gray-600">{ns.chunk_count.toLocaleString()} chunks</div>
                                    </div>
                                  ) : <span className="text-gray-700 text-xs">—</span>}
                                </td>
                                <td className="px-4 py-3 text-center">
                                  {ns.has_graph ? (
                                    <div>
                                      <span className="text-xs text-emerald-400 font-medium">{(ns.entity_count ?? 0).toLocaleString()} entities</span>
                                      <div className="text-[10px] text-gray-600">{(ns.relation_count ?? 0).toLocaleString()} rels</div>
                                    </div>
                                  ) : <span className="text-gray-700 text-xs">—</span>}
                                </td>
                                <td className="px-4 py-3">
                                  <div className="flex items-center gap-2">
                                    <div className="flex-1 bg-gray-800 rounded-full h-1.5">
                                      <div
                                        className="bg-purple-500 h-1.5 rounded-full transition-all"
                                        style={{ width: `${pct}%` }}
                                      />
                                    </div>
                                    <span className="text-xs text-gray-600 w-8 text-right tabular-nums">
                                      {Math.round(pct)}%
                                    </span>
                                  </div>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="border-t border-gray-700/60 bg-gray-900/40">
                            <td className="px-4 py-2.5 text-xs text-gray-500 font-medium" colSpan={2}>Total</td>
                            <td className="px-4 py-2.5 text-center text-xs text-blue-400/70 tabular-nums">
                              {namespaces.reduce((s, n) => s + n.document_count, 0).toLocaleString()} docs
                            </td>
                            <td className="px-4 py-2.5 text-center text-xs text-emerald-400/70 tabular-nums">
                              {namespaces.reduce((s, n) => s + (n.entity_count ?? 0), 0).toLocaleString()} entities
                            </td>
                            <td />
                          </tr>
                        </tfoot>
                      </table>
                    )
                  })()}
                </div>
              )}
            </div>

            {/* Gaps */}
            <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-4 flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-400">Knowledge Gaps (last 24h)</p>
                <p className={`text-2xl font-bold mt-0.5 ${!m ? 'text-gray-600' : (m.knowledge_gaps_24h ?? 0) > 5 ? 'text-red-400' : 'text-yellow-400'}`}>
                  {loading ? '—' : m?.knowledge_gaps_24h ?? '—'}
                </p>
              </div>
              <Link href="/knowledge-gaps" className="text-xs text-purple-400 hover:text-purple-300 transition-colors">
                View gaps →
              </Link>
            </div>
          </section>
        )}

        {activeTab === 'quality' && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Answer Quality (RAGAS)</h2>
              <Link href="/evaluation" className="text-xs text-purple-400 hover:text-purple-300 transition-colors">
                View full evaluation →
              </Link>
            </div>
            {ev ? (
              <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-5">
                <p className="text-xs text-gray-500 mb-4">{ev.sample_count} records evaluated</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                  {[
                    { label: 'Faithfulness', value: ev.faithfulness },
                    { label: 'Answer Relevance', value: ev.answer_relevance },
                    { label: 'Context Precision', value: ev.context_precision },
                    { label: 'Context Recall', value: ev.context_recall },
                  ].map(({ label, value }) => (
                    <div key={label} className="text-center">
                      <p className="text-xs text-gray-500 mb-1">{label}</p>
                      <ScoreChip value={value} />
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-5 text-center text-sm text-gray-500">
                {loading ? 'Loading…' : 'No evaluation data available'}
              </div>
            )}
          </section>
        )}

        {activeTab === 'users' && (
          <section>
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Memory Profiles</h2>
            {loading ? (
              <div className="space-y-2">
                {[...Array(3)].map((_, i) => <div key={i} className="h-12 bg-gray-800/40 rounded-xl animate-pulse" />)}
              </div>
            ) : users.length === 0 ? (
              <div className="bg-gray-800/40 border border-gray-700/50 rounded-xl p-8 text-center">
                <svg className="w-10 h-10 mx-auto mb-3 text-gray-600 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <p className="text-sm text-gray-500">No memory profiles yet</p>
              </div>
            ) : (
              <div className="bg-gray-800/40 border border-gray-700/50 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-700/50">
                      <th className="text-left text-xs text-gray-500 px-4 py-3 font-medium">Profile</th>
                      <th className="text-right text-xs text-gray-500 px-4 py-3 font-medium">Entries</th>
                      <th className="text-right text-xs text-gray-500 px-4 py-3 font-medium">Last Updated</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u, i) => (
                      <tr
                        key={u.user_id}
                        className={`${i < users.length - 1 ? 'border-b border-gray-700/30' : ''} hover:bg-gray-700/20 transition-colors`}
                      >
                        <td className="px-4 py-3 font-mono text-white text-xs">{u.user_id}</td>
                        <td className="px-4 py-3 text-right">
                          <span className="text-xs px-2 py-0.5 rounded bg-blue-900/30 text-blue-400 border border-blue-700/40">
                            {u.entry_count}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-xs text-gray-500">{formatDate(u.last_updated)}</td>
                        <td className="px-4 py-3 text-right">
                          <Link
                          href={`/memory/${encodeURIComponent(u.user_id)}`}
                          className="text-xs text-purple-400 hover:text-purple-300 transition-colors"
                        >
                            View →
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  )
}
