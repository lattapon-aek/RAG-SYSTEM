'use client'

import { useState, useEffect, useCallback } from 'react'
import Tabs from '@/components/Tabs'

interface EvalRecord {
  id: string
  request_id: string
  faithfulness: number | null
  answer_relevance: number | null
  context_precision: number | null
  context_recall: number | null
  evaluated_at: string | null
}

function ScoreBadge({ value }: { value: number | null }) {
  if (value === null || value === undefined) return <span className="text-gray-600 text-xs">—</span>
  const pct = Math.round(value * 100)
  const color =
    pct >= 80 ? 'text-green-400 border-green-800/50 bg-green-900/20'
    : pct >= 50 ? 'text-yellow-400 border-yellow-800/50 bg-yellow-900/20'
    : 'text-red-400 border-red-800/50 bg-red-900/20'
  return (
    <span className={`text-xs px-2 py-0.5 rounded border font-mono ${color}`}>
      {pct}%
    </span>
  )
}

function avg(records: EvalRecord[], key: keyof EvalRecord): number | null {
  const vals = records.map((r) => r[key] as number | null).filter((v) => v !== null) as number[]
  if (!vals.length) return null
  return vals.reduce((s, v) => s + v, 0) / vals.length
}

// Simple SVG sparkline — last N data points plotted as a polyline
function Sparkline({ data, color = '#10b981' }: { data: number[]; color?: string }) {
  if (data.length < 2) return <span className="text-xs text-gray-600 font-mono">not enough data</span>
  const W = 120, H = 28
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 0.01
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * W
    const y = H - ((v - min) / range) * (H - 4) - 2
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  const last = data[data.length - 1]
  const lastY = H - ((last - min) / range) * (H - 4) - 2
  return (
    <div className="flex items-center gap-2">
      <svg width={W} height={H} className="overflow-visible shrink-0">
        <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.5" />
        <circle cx={W} cy={lastY} r="2.5" fill={color} />
      </svg>
      <span className="text-xs font-mono" style={{ color }}>{Math.round(last * 100)}%</span>
    </div>
  )
}

function exportCsv(records: EvalRecord[]) {
  const header = 'id,request_id,faithfulness,answer_relevance,context_precision,context_recall,evaluated_at'
  const rows = records.map((r) =>
    [r.id, r.request_id, r.faithfulness ?? '', r.answer_relevance ?? '', r.context_precision ?? '', r.context_recall ?? '', r.evaluated_at ?? '']
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(',')
  )
  const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = 'evaluation.csv'; a.click()
  URL.revokeObjectURL(url)
}

const METRICS: { key: keyof EvalRecord; label: string; color: string }[] = [
  { key: 'faithfulness', label: 'Faithfulness', color: '#10b981' },
  { key: 'answer_relevance', label: 'Answer Relevance', color: '#3b82f6' },
  { key: 'context_precision', label: 'Context Precision', color: '#a855f7' },
  { key: 'context_recall', label: 'Context Recall', color: '#f59e0b' },
]

export default function EvaluationUI() {
  const [records, setRecords] = useState<EvalRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState('overview')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/evaluation?limit=100')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setRecords(await res.json())
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Sort chronologically for trend — most recent last
  const chronological = [...records].sort((a, b) =>
    new Date(a.evaluated_at ?? 0).getTime() - new Date(b.evaluated_at ?? 0).getTime()
  )
  const recent30 = chronological.slice(-30)

  function fmtScore(v: number | null) {
    return v === null ? '—' : `${Math.round(v * 100)}%`
  }

  function fmtDate(s: string | null) {
    if (!s) return '—'
    return new Date(s).toLocaleString()
  }

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'history', label: 'History', count: records.length },
  ]

  return (
    <div className="flex flex-col h-screen bg-gray-950">
      {/* Header */}
      <div className="shrink-0 px-6 pt-6 pb-4 border-b border-gray-800 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Evaluation</h1>
          <p className="text-sm text-gray-400 mt-1">
            RAGAS metrics — faithfulness, answer relevance, context precision &amp; recall
            {!loading && records.length > 0 && (
              <span className="ml-2 text-gray-500">({records.length} records)</span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          {records.length > 0 && (
            <button
              onClick={() => exportCsv(records)}
              className="text-xs text-gray-400 hover:text-white px-3 py-1.5 rounded-lg border border-gray-700 hover:border-gray-500 transition-colors"
            >
              Export CSV
            </button>
          )}
          <button
            onClick={load}
            className="text-xs text-gray-400 hover:text-white transition-colors px-3 py-1.5 rounded-lg border border-gray-700 hover:border-gray-500"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="shrink-0 px-6 py-4 grid grid-cols-4 gap-4 border-b border-gray-800">
        {METRICS.map(({ key, label }) => {
          const value = avg(records, key)
          return (
            <div key={key} className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-4">
              <p className="text-xs text-gray-400 mb-1">{label}</p>
              <p className={`text-2xl font-bold ${
                value === null ? 'text-gray-600'
                : value >= 0.80 ? 'text-green-400'
                : value >= 0.5 ? 'text-yellow-400'
                : 'text-red-400'
              }`}>
                {loading ? '—' : fmtScore(value)}
              </p>
            </div>
          )
        })}
      </div>

      {/* Tabs bar */}
      <div className="shrink-0 px-6">
        <Tabs tabs={tabs} active={activeTab} onChange={setActiveTab} />
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

        {activeTab === 'overview' && (
          <>
            {recent30.length >= 2 ? (
              <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-5">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">
                  Trend — last {recent30.length} evaluations
                </p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                  {METRICS.map(({ key, label, color }) => {
                    const vals = recent30.map((r) => r[key] as number | null).filter((v) => v !== null) as number[]
                    return (
                      <div key={key}>
                        <p className="text-xs text-gray-500 mb-2">{label}</p>
                        <Sparkline data={vals} color={color} />
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-500">Not enough data to show trends — at least 2 evaluations required.</p>
            )}
          </>
        )}

        {activeTab === 'history' && (
          <>
            {loading ? (
              <div className="space-y-2">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="h-12 bg-gray-800/40 rounded-xl animate-pulse" />
                ))}
              </div>
            ) : records.length === 0 ? (
              <div className="text-center py-12 text-gray-600">
                <svg className="w-10 h-10 mx-auto mb-3 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                <p className="text-sm">No evaluations yet — evaluations run automatically after queries with citations</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 border-b border-gray-700/50">
                      <th className="pb-2 pr-4 font-medium">Evaluated At</th>
                      <th className="pb-2 pr-4 font-medium">Faithfulness</th>
                      <th className="pb-2 pr-4 font-medium">Answer Relevance</th>
                      <th className="pb-2 pr-4 font-medium">Context Precision</th>
                      <th className="pb-2 pr-4 font-medium">Context Recall</th>
                      <th className="pb-2 font-medium">Request ID</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700/30">
                    {records.map((r) => (
                      <tr key={r.id} className="hover:bg-gray-800/40 transition-colors">
                        <td className="py-2.5 pr-4 text-gray-400 text-xs whitespace-nowrap">{fmtDate(r.evaluated_at)}</td>
                        <td className="py-2.5 pr-4"><ScoreBadge value={r.faithfulness} /></td>
                        <td className="py-2.5 pr-4"><ScoreBadge value={r.answer_relevance} /></td>
                        <td className="py-2.5 pr-4"><ScoreBadge value={r.context_precision} /></td>
                        <td className="py-2.5 pr-4"><ScoreBadge value={r.context_recall} /></td>
                        <td className="py-2.5 text-gray-600 font-mono text-xs truncate max-w-[160px]">
                          {r.request_id.slice(0, 8)}…
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
