'use client'

import { useState } from 'react'
import Tabs from '@/components/Tabs'
import type { MetricsSummary, EvaluationSummary, QueueStats, NamespaceSummary, RateLimitStats, RateLimitClient, GraphStats, MemoryStats } from '@/types'

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({
  title, value, subtitle, color = 'blue',
}: {
  title: string; value: string; subtitle?: string
  color?: 'blue' | 'green' | 'yellow' | 'red' | 'purple'
}) {
  const colorMap = {
    blue: 'text-blue-400', green: 'text-green-400',
    yellow: 'text-yellow-400', red: 'text-red-400', purple: 'text-purple-400',
  }
  return (
    <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
      <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">{title}</p>
      <p className={`text-xl font-bold mt-1 ${colorMap[color]}`}>{value}</p>
      {subtitle && <p className="text-[11px] text-gray-500 mt-0.5">{subtitle}</p>}
    </div>
  )
}

function MetricBar({ label, value }: { label: string; value: number }) {
  const pct = Math.min(Math.max(value * 100, 0), 100)
  const color = pct >= 80 ? 'bg-green-500' : pct >= 60 ? 'bg-yellow-500' : 'bg-red-500'
  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <span className="text-sm text-gray-300">{label}</span>
        <span className="text-sm font-semibold text-white">{pct.toFixed(1)}%</span>
      </div>
      <div className="w-full bg-gray-700 rounded-full h-2">
        <div className={`${color} h-2 rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  metrics: MetricsSummary | null
  evaluation: EvaluationSummary | null
  queueStats: QueueStats | null
  namespaces: NamespaceSummary[]
  rateLimit: RateLimitStats | null
  graphStats: GraphStats | null
  memoryStats: MemoryStats | null
  metricsError: string | null
  evalError: string | null
  namespaceError: string | null
}

const TABS = [
  { id: 'performance', label: 'Performance' },
  { id: 'knowledge', label: 'Knowledge Base' },
  { id: 'quality', label: 'Answer Quality' },
  { id: 'operations', label: 'Operations' },
]

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function DashboardUI({
  metrics, evaluation, queueStats, namespaces, rateLimit,
  graphStats, memoryStats,
  metricsError, evalError, namespaceError,
}: Props) {
  const [activeTab, setActiveTab] = useState('performance')

  const safeNamespaces = Array.isArray(namespaces) ? namespaces : []
  const safeFailures = Array.isArray(queueStats?.recent_failures) ? queueStats!.recent_failures : []
  const safeTopClients = Array.isArray(rateLimit?.top_clients) ? rateLimit!.top_clients : []

  // Knowledge Base tab pre-computations
  const totalDocs = safeNamespaces.reduce((s, ns) => s + (ns.document_count || 0), 0)
  const totalChunks = safeNamespaces.reduce((s, ns) => s + (ns.chunk_count || 0), 0)
  const kbDocCount = safeNamespaces.length > 0 ? totalDocs : (metrics?.document_count ?? 0)
  const kbChunkCount = safeNamespaces.length > 0 ? totalChunks : (metrics?.chunk_count ?? 0)

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-gray-100">

      {/* ── Fixed KPI row ──────────────────────────────────────────── */}
      <div className="shrink-0 border-b border-gray-800 px-6 py-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-base font-semibold text-white">Dashboard</h1>
            <p className="text-xs text-gray-500">RAG system overview</p>
          </div>
        </div>

        {metricsError ? (
          <div className="bg-red-900/30 border border-red-700 rounded-lg px-4 py-2 text-red-400 text-xs">
            {metricsError}
          </div>
        ) : metrics ? (
          <div className="grid grid-cols-4 gap-3">
            <StatCard
              title="Total Queries"
              value={(metrics.query_volume_total ?? 0).toLocaleString()}
              color="blue"
            />
            <StatCard
              title="Cache Hit Rate"
              value={`${((metrics.cache_hit_rate ?? 0) * 100).toFixed(1)}%`}
              subtitle="semantic cache"
              color="yellow"
            />
            <StatCard
              title="Pending Approvals"
              value={(metrics.pending_approvals ?? 0).toString()}
              subtitle="awaiting review"
              color={(metrics.pending_approvals ?? 0) > 0 ? 'yellow' : 'green'}
            />
            <StatCard
              title="Knowledge Gaps"
              value={(metrics.knowledge_gaps_24h ?? 0).toString()}
              subtitle="last 24h"
              color={(metrics.knowledge_gaps_24h ?? 0) > 0 ? 'red' : 'green'}
            />
          </div>
        ) : null}
      </div>

      {/* ── Tabs ───────────────────────────────────────────────────── */}
      <div className="shrink-0 px-6">
        <Tabs tabs={TABS} active={activeTab} onChange={setActiveTab} />
      </div>

      {/* ── Tab content ────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* PERFORMANCE */}
        {activeTab === 'performance' && (
          <div className="space-y-6 max-w-3xl">
            {metrics ? (
              <>
                <div className="grid grid-cols-3 gap-4">
                  <StatCard
                    title="Avg Retrieval"
                    value={`${(metrics.avg_retrieval_latency_ms ?? 0).toFixed(1)} ms`}
                    subtitle="retrieval latency"
                    color="green"
                  />
                  <StatCard
                    title="Avg Generation"
                    value={`${(metrics.avg_generation_latency_ms ?? 0).toFixed(1)} ms`}
                    subtitle="LLM latency"
                    color="purple"
                  />
                  <StatCard
                    title="Avg Total"
                    value={`${(metrics.avg_total_latency_ms ?? 0).toFixed(1)} ms`}
                    subtitle="end-to-end"
                    color="blue"
                  />
                </div>

                {/* Circuit Breakers */}
                {Array.isArray(metrics.circuit_breakers) && metrics.circuit_breakers.length > 0 && (
                  <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                    <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                      Circuit Breakers
                    </h3>
                    <div className="space-y-2">
                      {metrics.circuit_breakers.map((cb) => {
                        const stateColor = cb.state === 'closed'
                          ? 'text-green-400 bg-green-400/10'
                          : cb.state === 'open'
                          ? 'text-red-400 bg-red-400/10'
                          : 'text-yellow-400 bg-yellow-400/10'
                        return (
                          <div key={cb.name} className="flex items-center justify-between py-1.5">
                            <span className="text-sm text-gray-300 font-mono">{cb.name}</span>
                            <div className="flex items-center gap-3">
                              <span className="text-xs text-gray-500">{cb.failure_count} failures</span>
                              <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase ${stateColor}`}>
                                {cb.state}
                              </span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="text-gray-600 text-sm">No performance data available.</div>
            )}
          </div>
        )}

        {/* KNOWLEDGE BASE */}
        {activeTab === 'knowledge' && (
          <div className="space-y-5 max-w-3xl">

            {/* ── Section 1: Documents ─────────────────────────────── */}
            <section>
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 inline-block" />
                Documents
              </h2>
              <div className="grid grid-cols-2 gap-4">
                <StatCard
                  title="Total Documents"
                  value={kbDocCount.toLocaleString()}
                  subtitle={safeNamespaces.length > 1 ? `across ${safeNamespaces.length} namespaces` : undefined}
                  color="blue"
                />
                <StatCard
                  title="Total Chunks"
                  value={kbChunkCount.toLocaleString()}
                  subtitle={kbDocCount > 0 ? `avg ${(kbChunkCount / kbDocCount).toFixed(1)} per doc` : undefined}
                  color="green"
                />
              </div>
            </section>

            {/* ── Section 2: Knowledge Graph ───────────────────────── */}
            <section>
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-purple-400 inline-block" />
                Knowledge Graph
              </h2>
              {graphStats ? (
                <div className="grid grid-cols-2 gap-4">
                  <StatCard title="Entities" value={(graphStats.entity_count ?? 0).toLocaleString()} subtitle="nodes in Neo4j" color="purple" />
                  <StatCard title="Relations" value={(graphStats.relation_count ?? 0).toLocaleString()} subtitle="edges in Neo4j" color="blue" />
                </div>
              ) : (
                <div className="bg-gray-900 rounded-xl p-4 border border-gray-800 text-sm text-gray-500">Graph service unavailable.</div>
              )}
            </section>

            {/* ── Section 3: Memory ────────────────────────────────── */}
            <section>
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 inline-block" />
                Memory
              </h2>
              {memoryStats ? (
                <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                  <div className="grid grid-cols-2 divide-x divide-gray-800">
                    <div className="p-5">
                      <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-3">
                        Short-term <span className="normal-case text-gray-600 font-normal">(Redis · TTL 1h)</span>
                      </p>
                      <div className="space-y-3">
                        <div>
                          <p className="text-[11px] text-gray-500">Active Users</p>
                          <p className="text-xl font-bold text-yellow-400">{(memoryStats.short_term_users ?? 0).toLocaleString()}</p>
                        </div>
                        <div>
                          <p className="text-[11px] text-gray-500">Total Entries</p>
                          <p className="text-xl font-bold text-yellow-300">{(memoryStats.short_term_entries ?? 0).toLocaleString()}</p>
                        </div>
                      </div>
                    </div>
                    <div className="p-5">
                      <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-3">
                        Long-term <span className="normal-case text-gray-600 font-normal">(PostgreSQL · persistent)</span>
                      </p>
                      <div className="space-y-3">
                        <div>
                          <p className="text-[11px] text-gray-500">Users with History</p>
                          <p className="text-xl font-bold text-green-400">{(memoryStats.long_term_users ?? 0).toLocaleString()}</p>
                        </div>
                        <div>
                          <p className="text-[11px] text-gray-500">Total Entries</p>
                          <p className="text-xl font-bold text-green-300">{(memoryStats.long_term_entries ?? 0).toLocaleString()}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-gray-900 rounded-xl p-4 border border-gray-800 text-sm text-gray-500">Memory stats unavailable.</div>
              )}
            </section>

          </div>
        )}

        {/* ANSWER QUALITY */}
        {activeTab === 'quality' && (
          <div className="max-w-2xl">
            {evalError ? (
              <div className="bg-red-900/30 border border-red-700 rounded-xl p-4 text-red-400 text-sm">
                {evalError}
              </div>
            ) : (evaluation || metrics?.avg_grounding_score !== undefined) ? (
              <div className="space-y-5">
                {evaluation && (
                  <div className="flex items-center gap-3 text-xs text-gray-500">
                    <span>{evaluation.sample_count} evaluation samples</span>
                  </div>
                )}
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
                  {metrics?.avg_grounding_score !== undefined && (
                    <MetricBar label="Citation Grounding" value={metrics.avg_grounding_score} />
                  )}
                  {evaluation && (
                    <>
                      <MetricBar label="Faithfulness" value={evaluation.faithfulness} />
                      <MetricBar label="Answer Relevance" value={evaluation.answer_relevance} />
                      <MetricBar label="Context Precision" value={evaluation.context_precision} />
                      <MetricBar label="Context Recall" value={evaluation.context_recall} />
                    </>
                  )}
                </div>

                {/* Score summary cards */}
                {evaluation && (
                  <div className="grid grid-cols-2 gap-3">
                    <StatCard
                      title="Faithfulness"
                      value={`${(evaluation.faithfulness * 100).toFixed(1)}%`}
                      color={evaluation.faithfulness >= 0.8 ? 'green' : 'yellow'}
                    />
                    <StatCard
                      title="Answer Relevance"
                      value={`${(evaluation.answer_relevance * 100).toFixed(1)}%`}
                      color={evaluation.answer_relevance >= 0.8 ? 'green' : 'yellow'}
                    />
                    <StatCard
                      title="Context Precision"
                      value={`${(evaluation.context_precision * 100).toFixed(1)}%`}
                      color={evaluation.context_precision >= 0.8 ? 'green' : 'yellow'}
                    />
                    <StatCard
                      title="Context Recall"
                      value={`${(evaluation.context_recall * 100).toFixed(1)}%`}
                      color={evaluation.context_recall >= 0.8 ? 'green' : 'yellow'}
                    />
                  </div>
                )}
              </div>
            ) : (
              <div className="text-gray-600 text-sm">No quality data available.</div>
            )}
          </div>
        )}

        {/* OPERATIONS */}
        {activeTab === 'operations' && (
          <div className="space-y-6 max-w-3xl">

            {/* Queue */}
            {queueStats ? (
              <div>
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                  Ingestion Queue
                </h3>
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <StatCard
                    title="Queued"
                    value={(queueStats.queue_depth ?? 0).toString()}
                    subtitle="waiting"
                    color={queueStats.queue_depth > 0 ? 'yellow' : 'green'}
                  />
                  <StatCard
                    title="Processing"
                    value={(queueStats.processing ?? 0).toString()}
                    subtitle="in progress"
                    color={queueStats.processing > 0 ? 'blue' : 'green'}
                  />
                  <StatCard
                    title="Failed"
                    value={(queueStats.failed_total ?? 0).toString()}
                    subtitle="permanent"
                    color={queueStats.failed_total > 0 ? 'red' : 'green'}
                  />
                </div>
                {safeFailures.length > 0 && (
                  <div className="bg-gray-900 border border-red-800/40 rounded-xl p-4">
                    <p className="text-xs font-semibold text-red-400 mb-2">Recent Failures</p>
                    <ul className="space-y-1">
                      {safeFailures.map((f, i) => (
                        <li key={i} className="text-xs text-gray-400">
                          <span className="text-gray-200">{f.filename}</span>
                          {f.error && <span className="text-red-400 ml-2">— {f.error}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-gray-600 text-sm">Queue data unavailable.</div>
            )}

            {/* Rate Limits */}
            {rateLimit && (
              <div>
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                  Rate Limits
                </h3>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <StatCard
                    title="Active Clients"
                    value={(rateLimit.active_clients ?? 0).toString()}
                    subtitle="current minute"
                    color={rateLimit.active_clients > 0 ? 'blue' : 'green'}
                  />
                  <StatCard
                    title="Default RPM"
                    value={(rateLimit.default_rpm ?? 0).toString()}
                    subtitle="per client"
                    color="yellow"
                  />
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                  <div className="grid grid-cols-[1.6fr_0.8fr_0.8fr] gap-4 px-5 py-3 border-b border-gray-800 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                    <span>Client</span>
                    <span>Req/Min</span>
                    <span>RPM Limit</span>
                  </div>
                  <div className="divide-y divide-gray-800/60">
                    {safeTopClients.length === 0 ? (
                      <div className="px-5 py-4 text-sm text-gray-500">No active counters.</div>
                    ) : (
                      safeTopClients.slice(0, 10).map((c: RateLimitClient) => (
                        <div key={c.client_id} className="grid grid-cols-[1.6fr_0.8fr_0.8fr] gap-4 px-5 py-2.5 text-sm">
                          <span className="font-mono text-white truncate">{c.client_id}</span>
                          <span className="text-yellow-400">{c.requests_this_minute}</span>
                          <span className="text-gray-400">
                            {c.rpm_limit ?? '—'}
                            {c.has_override && (
                              <span className="ml-1 text-[9px] text-purple-400">override</span>
                            )}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
