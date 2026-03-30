'use client'

import { useState, useEffect, useCallback } from 'react'
import Pagination from '@/components/Pagination'

interface FeedbackRecord {
  id: string
  request_id: string
  query_text?: string
  answer_text?: string
  feedback_score: number
  comment?: string
  category?: string
  namespace?: string
  source_type?: string
  source_id?: string
  user_id?: string
  created_at?: string
}

interface FeedbackStats {
  avg_score: number
  recent_count: number
}

interface AnalyticsRow {
  namespace?: string
  category?: string
  date?: string
  total: number
  good_count: number
  bad_count: number
  bad_rate: number
}

interface Analytics {
  by_namespace: AnalyticsRow[]
  by_category: AnalyticsRow[]
  daily_trend: AnalyticsRow[]
}

const CATEGORY_LABELS: Record<string, { label: string; emoji: string; color: string }> = {
  general:       { label: 'General',       emoji: '❓', color: 'text-gray-400 bg-gray-800 border-gray-700' },
  wrong_answer:  { label: 'Wrong answer',  emoji: '❌', color: 'text-red-400 bg-red-900/20 border-red-800/50' },
  incomplete:    { label: 'Incomplete',    emoji: '📝', color: 'text-amber-400 bg-amber-900/20 border-amber-800/50' },
  off_topic:     { label: 'Off-topic',     emoji: '🔀', color: 'text-blue-400 bg-blue-900/20 border-blue-800/50' },
  hallucination: { label: 'Hallucination', emoji: '🤖', color: 'text-purple-400 bg-purple-900/20 border-purple-800/50' },
}

function CategoryBadge({ category }: { category?: string }) {
  const key = category ?? 'general'
  const cfg = CATEGORY_LABELS[key] ?? CATEGORY_LABELS.general
  return (
    <span className={`inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded border font-medium ${cfg.color}`}>
      {cfg.emoji} {cfg.label}
    </span>
  )
}

function ScoreBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100)
  const color = score >= 0.7 ? 'text-green-400 border-green-700/50 bg-green-900/20'
    : score >= 0.4 ? 'text-yellow-400 border-yellow-700/50 bg-yellow-900/20'
    : 'text-red-400 border-red-700/50 bg-red-900/20'
  return (
    <span className={`text-xs px-2 py-0.5 rounded border font-mono ${color}`}>
      {pct}%
    </span>
  )
}

function ThumbIcon({ score }: { score: number }) {
  if (score >= 0.5) {
    return (
      <span title="Good" className="text-green-400 shrink-0 mt-0.5">
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" />
        </svg>
      </span>
    )
  }
  return (
    <span title="Bad" className="text-red-400 shrink-0 mt-0.5">
      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
        <path d="M10 14H5.236a2 2 0 01-1.789-2.894l3.5-7A2 2 0 018.736 3h4.018a2 2 0 01.485.06l3.76.94m-7 10v5a2 2 0 002 2h.095c.5 0 .905-.405.905-.905 0-.714.211-1.412.608-2.006L17 13V4m-7 10h2m5-10h2a2 2 0 012 2v6a2 2 0 01-2 2h-2.5" />
      </svg>
    </span>
  )
}

function MiniBarChart({ rows, labelKey, valueKey = 'bad_rate', color = '#ef4444' }: {
  rows: Record<string, any>[]
  labelKey: string
  valueKey?: string
  color?: string
}) {
  const max = Math.max(...rows.map((r) => r[valueKey] ?? 0), 0.01)
  return (
    <div className="space-y-1.5">
      {rows.slice(0, 6).map((r, i) => {
        const pct = ((r[valueKey] ?? 0) / max) * 100
        const label = CATEGORY_LABELS[r[labelKey]]?.emoji
          ? `${CATEGORY_LABELS[r[labelKey]].emoji} ${CATEGORY_LABELS[r[labelKey]].label}`
          : r[labelKey] ?? '—'
        return (
          <div key={i} className="flex items-center gap-2">
            <span className="text-[9px] text-gray-400 w-28 truncate shrink-0">{label}</span>
            <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
            </div>
            <span className="text-[9px] text-gray-500 w-10 text-right shrink-0">
              {Math.round((r[valueKey] ?? 0) * 100)}% ({r.bad_count ?? 0})
            </span>
          </div>
        )
      })}
    </div>
  )
}

function DailyTrendChart({ rows }: { rows: AnalyticsRow[] }) {
  const maxTotal = Math.max(...rows.map((r) => r.total), 1)
  return (
    <div className="flex items-end gap-1 h-16">
      {rows.slice(-14).map((r, i) => {
        const totalH = (r.total / maxTotal) * 100
        const badH = r.total > 0 ? (r.bad_count / r.total) * totalH : 0
        const goodH = totalH - badH
        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-0" title={`${r.date}: ${r.good_count}👍 ${r.bad_count}👎`}>
            <div className="w-full flex flex-col justify-end" style={{ height: '56px' }}>
              <div className="w-full rounded-t-sm" style={{ height: `${goodH}%`, backgroundColor: '#22c55e', minHeight: r.good_count > 0 ? 2 : 0 }} />
              <div className="w-full" style={{ height: `${badH}%`, backgroundColor: '#ef4444', minHeight: r.bad_count > 0 ? 2 : 0 }} />
            </div>
            <span className="text-[7px] text-gray-600 mt-0.5 truncate w-full text-center">
              {r.date ? r.date.slice(5) : ''}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function exportCsv(records: FeedbackRecord[]) {
  const header = 'id,request_id,query_text,feedback_score,category,namespace,source_type,source_id,user_id,comment,created_at'
  const rows = records.map((r) =>
    [
      r.id,
      r.request_id,
      r.query_text ?? '',
      r.feedback_score,
      r.category ?? 'general',
      r.namespace ?? 'default',
      r.source_type ?? 'chat',
      r.source_id ?? '',
      r.user_id ?? '',
      r.comment ?? '',
      r.created_at ?? '',
    ]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(',')
  )
  const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = 'feedback.csv'; a.click()
  URL.revokeObjectURL(url)
}

export default function FeedbackUI() {
  const [stats, setStats] = useState<FeedbackStats | null>(null)
  const [records, setRecords] = useState<FeedbackRecord[]>([])
  const [analytics, setAnalytics] = useState<Analytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<'all' | 'good' | 'bad'>('all')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [reportPage, setReportPage] = useState(1)

  const [showTestForm, setShowTestForm] = useState(false)
  const [testQuery, setTestQuery] = useState('')
  const [testRequestId, setTestRequestId] = useState(() => `test-${Date.now()}`)
  const [testScore, setTestScore] = useState(1)
  const [testCategory, setTestCategory] = useState('general')
  const [testComment, setTestComment] = useState('')
  const [testNamespace, setTestNamespace] = useState('default')
  const [testSourceType, setTestSourceType] = useState('chat')
  const [testSourceId, setTestSourceId] = useState('')
  const [testUserId, setTestUserId] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submitTestFeedback() {
    if (!testRequestId.trim()) return
    setSubmitting(true)
    try {
      await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          request_id: testRequestId.trim(),
          feedback_score: testScore,
          query_text: testQuery.trim() || undefined,
          comment: testComment.trim() || undefined,
          category: testCategory,
          namespace: testNamespace.trim() || undefined,
          source_type: testSourceType.trim() || 'chat',
          source_id: testSourceId.trim() || undefined,
          user_id: testUserId.trim() || undefined,
        }),
      })
      await load()
      setShowTestForm(false)
      setTestQuery('')
      setTestRequestId(`test-${Date.now()}`)
      setTestScore(1)
      setTestCategory('general')
      setTestComment('')
      setTestNamespace('default')
      setTestSourceType('chat')
      setTestSourceId('')
      setTestUserId('')
    } finally {
      setSubmitting(false)
    }
  }

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [statsRes, listRes, analyticsRes] = await Promise.all([
        fetch('/api/feedback'),
        fetch('/api/feedback/list'),
        fetch('/api/feedback/analytics'),
      ])
      if (statsRes.ok) setStats(await statsRes.json())
      if (listRes.ok) setRecords(await listRes.json())
      if (analyticsRes.ok) setAnalytics(await analyticsRes.json())
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = records.filter((r) => {
    if (filter === 'good' && r.feedback_score < 0.5) return false
    if (filter === 'bad' && r.feedback_score >= 0.5) return false
    if (categoryFilter !== 'all' && (r.category ?? 'general') !== categoryFilter) return false
    return true
  })

  const goodCount = records.filter((r) => r.feedback_score >= 0.5).length
  const badCount = records.filter((r) => r.feedback_score < 0.5).length

  const reportPanels = analytics
    ? [
        {
          key: 'namespace',
          title: 'Bad rate by namespace',
          body: analytics.by_namespace.length > 0
            ? <MiniBarChart rows={analytics.by_namespace} labelKey="namespace" />
            : <p className="text-xs text-gray-600">No data</p>,
        },
        {
          key: 'category',
          title: 'Bad rate by category',
          body: analytics.by_category.length > 0
            ? <MiniBarChart rows={analytics.by_category} labelKey="category" color="#f97316" />
            : <p className="text-xs text-gray-600">No data</p>,
        },
        {
          key: 'trend',
          title: 'Daily trend (14d)',
          body: (
            <>
              {analytics.daily_trend.length > 0
                ? <DailyTrendChart rows={analytics.daily_trend} />
                : <p className="text-xs text-gray-600">No data yet</p>}
              <div className="flex gap-3 mt-2">
                <span className="flex items-center gap-1 text-[9px] text-gray-500"><span className="w-2 h-2 rounded-sm bg-green-500 inline-block" />Good</span>
                <span className="flex items-center gap-1 text-[9px] text-gray-500"><span className="w-2 h-2 rounded-sm bg-red-500 inline-block" />Bad</span>
              </div>
            </>
          ),
        },
      ]
    : []

  const safeReportPage = Math.min(reportPage, Math.max(1, reportPanels.length))
  const reportPanel = reportPanels[safeReportPage - 1]

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const paged = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  function handleFilterChange(f: 'all' | 'good' | 'bad') { setFilter(f); setPage(1) }
  function handleCategoryFilter(c: string) { setCategoryFilter(c); setPage(1) }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-6 overflow-hidden">
      <div className="shrink-0 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Feedback</h1>
          <p className="text-sm text-gray-400 mt-1">User ratings on RAG answers — low scores auto-enqueue to Approvals for review</p>
        </div>
        <div className="flex gap-2">
          {records.length > 0 && (
            <button onClick={() => exportCsv(filtered)} className="text-xs text-gray-400 hover:text-white transition-colors px-3 py-1.5 rounded-lg border border-gray-700 hover:border-gray-500">
              Export CSV
            </button>
          )}
          <button onClick={load} className="text-xs text-gray-400 hover:text-white transition-colors px-3 py-1.5 rounded-lg border border-gray-700 hover:border-gray-500">
            Refresh
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="shrink-0 grid grid-cols-3 gap-4">
        <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-4">
          <p className="text-xs text-gray-400 mb-1">Avg Score</p>
          <p className={`text-2xl font-bold ${(stats?.avg_score ?? 0) >= 0.7 ? 'text-green-400' : (stats?.avg_score ?? 0) >= 0.4 ? 'text-yellow-400' : 'text-red-400'}`}>
            {stats ? `${Math.round(stats.avg_score * 100)}%` : '—'}
          </p>
        </div>
        <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-4">
          <p className="text-xs text-gray-400 mb-1">Good</p>
          <p className="text-2xl font-bold text-green-400">{loading ? '—' : goodCount}</p>
        </div>
        <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-4">
          <p className="text-xs text-gray-400 mb-1">Bad</p>
          <p className="text-2xl font-bold text-red-400">{loading ? '—' : badCount}</p>
          <p className="text-xs text-gray-500 mt-0.5">auto-sent to Approvals</p>
        </div>
      </div>

      {/* Report */}
      {analytics && reportPanels.length > 0 && reportPanel && (
        <div className="shrink-0 rounded-xl border border-gray-700/50 bg-gray-800/40 overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-gray-700/50">
            <div>
              <p className="text-xs font-medium text-gray-300">Report</p>
              <p className="text-[10px] text-gray-500">Paging view to keep the page compact</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setReportPage((p) => Math.max(1, p - 1))}
                disabled={safeReportPage <= 1}
                className="px-2.5 py-1 rounded-lg text-xs border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500 disabled:opacity-40 disabled:hover:border-gray-700"
              >
                Prev
              </button>
              <span className="text-[10px] text-gray-500 font-mono">
                {safeReportPage}/{reportPanels.length}
              </span>
              <button
                onClick={() => setReportPage((p) => Math.min(reportPanels.length, p + 1))}
                disabled={safeReportPage >= reportPanels.length}
                className="px-2.5 py-1 rounded-lg text-xs border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500 disabled:opacity-40 disabled:hover:border-gray-700"
              >
                Next
              </button>
            </div>
          </div>
          <div className="p-4">
            <p className="text-xs text-gray-400 mb-3 font-medium">{reportPanel.title}</p>
            {reportPanel.body}
          </div>
        </div>
      )}

      {/* Test feedback form */}
      <div className="shrink-0 rounded-xl border border-gray-700/50 bg-gray-800/40 overflow-hidden">
        <button onClick={() => setShowTestForm((v) => !v)} className="w-full flex items-center justify-between px-4 py-3 text-xs text-gray-400 hover:text-white transition-colors">
          <span className="flex items-center gap-2">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            Submit Test Feedback
          </span>
          <svg className={`w-3.5 h-3.5 transition-transform ${showTestForm ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
        </button>
        {showTestForm && (
          <div className="border-t border-gray-700/50 p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] text-gray-500 mb-1">Request ID <span className="text-red-500">*</span></label>
                <input value={testRequestId} onChange={(e) => setTestRequestId(e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-white font-mono outline-none focus:border-purple-500" />
              </div>
              <div>
                <label className="block text-[10px] text-gray-500 mb-1">Score</label>
                <div className="flex gap-2">
                  <button onClick={() => { setTestScore(1); setTestCategory('general') }} className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors border ${testScore === 1 ? 'bg-green-900/40 border-green-700/60 text-green-400' : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500'}`}>👍 Good</button>
                  <button onClick={() => setTestScore(0)} className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors border ${testScore === 0 ? 'bg-red-900/40 border-red-700/60 text-red-400' : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500'}`}>👎 Bad</button>
                </div>
              </div>
            </div>
            {testScore === 0 && (
              <div>
                <label className="block text-[10px] text-gray-500 mb-1">Category</label>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(CATEGORY_LABELS).map(([val, cfg]) => (
                    <button key={val} onClick={() => setTestCategory(val)} className={`px-2.5 py-1 rounded-lg text-xs transition-colors border ${testCategory === val ? 'bg-gray-700 border-gray-500 text-white' : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'}`}>
                      {cfg.emoji} {cfg.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div>
              <label className="block text-[10px] text-gray-500 mb-1">Query text (optional)</label>
              <input value={testQuery} onChange={(e) => setTestQuery(e.target.value)} placeholder="e.g. What is RAG?" className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:border-purple-500 placeholder-gray-600" />
            </div>
            <div>
              <label className="block text-[10px] text-gray-500 mb-1">Comment (optional)</label>
              <input value={testComment} onChange={(e) => setTestComment(e.target.value)} placeholder="e.g. Answer was too vague" className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:border-purple-500 placeholder-gray-600" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] text-gray-500 mb-1">Namespace (optional)</label>
                <input value={testNamespace} onChange={(e) => setTestNamespace(e.target.value)} placeholder="default" className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:border-purple-500 placeholder-gray-600" />
              </div>
              <div>
                <label className="block text-[10px] text-gray-500 mb-1">Source type</label>
                <input value={testSourceType} onChange={(e) => setTestSourceType(e.target.value)} placeholder="chat | mcp_agent" className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:border-purple-500 placeholder-gray-600" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] text-gray-500 mb-1">Source ID (optional)</label>
                <input value={testSourceId} onChange={(e) => setTestSourceId(e.target.value)} placeholder="assistant msg id or agent id" className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:border-purple-500 placeholder-gray-600" />
              </div>
              <div>
                <label className="block text-[10px] text-gray-500 mb-1">User ID (optional)</label>
                <input value={testUserId} onChange={(e) => setTestUserId(e.target.value)} placeholder="user-123" className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:border-purple-500 placeholder-gray-600" />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowTestForm(false)} className="px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-white transition-colors">Cancel</button>
              <button onClick={submitTestFeedback} disabled={submitting || !testRequestId.trim()} className="px-4 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-medium transition-colors disabled:opacity-40">
                {submitting ? 'Submitting…' : 'Submit'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="shrink-0 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          {(['all', 'good', 'bad'] as const).map((f) => (
            <button key={f} onClick={() => handleFilterChange(f)} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize ${filter === f ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
              {f === 'all' ? `All (${records.length})` : f === 'good' ? `Good (${goodCount})` : `Bad (${badCount})`}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 ml-2">
          <button onClick={() => handleCategoryFilter('all')} className={`px-2 py-1 rounded-lg text-xs transition-colors ${categoryFilter === 'all' ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-white'}`}>
            All categories
          </button>
          {Object.entries(CATEGORY_LABELS).map(([val, cfg]) => (
            <button key={val} onClick={() => handleCategoryFilter(val)} className={`px-2 py-1 rounded-lg text-xs transition-colors ${categoryFilter === val ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-white'}`}>
              {cfg.emoji}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="shrink-0 text-sm text-red-400">{error}</p>}

      <div className="flex-1 min-h-0 overflow-hidden rounded-xl border border-gray-700/50 bg-gray-800/40">
        <div className="h-full min-h-0 overflow-y-auto p-4">
          {loading ? (
            <div className="space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="h-14 bg-gray-800/40 rounded-xl animate-pulse" />)}</div>
          ) : paged.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <svg className="w-10 h-10 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
              <p className="text-sm">No feedback records</p>
              <p className="text-xs mt-1">Use 👍/👎 in Chat to submit feedback</p>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                {paged.map((r) => (
                  <div key={r.id} className="bg-gray-800/60 border border-gray-700/50 rounded-xl px-4 py-3 space-y-2">
                <div className="flex items-start gap-3">
                  <ThumbIcon score={r.feedback_score} />
                  <div className="flex-1 min-w-0">
                    {r.query_text
                      ? <p className="text-sm text-white font-medium leading-snug">&ldquo;{r.query_text}&rdquo;</p>
                      : <p className="text-xs text-gray-600 italic">No query text recorded</p>}
                    <p className="text-[10px] font-mono text-gray-600 mt-0.5 truncate">req: {r.request_id}</p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      <span className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded border border-gray-700 bg-gray-900 text-gray-400">
                        ns: {r.namespace ?? 'default'}
                      </span>
                      <span className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded border border-gray-700 bg-gray-900 text-gray-400">
                        {r.source_type ?? 'chat'}
                      </span>
                      {r.source_id && (
                        <span className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded border border-gray-700 bg-gray-900 text-gray-500 font-mono">
                          src: {r.source_id}
                        </span>
                      )}
                      {r.user_id && (
                        <span className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded border border-gray-700 bg-gray-900 text-gray-500 font-mono">
                          user: {r.user_id}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                    <CategoryBadge category={r.category} />
                    <ScoreBadge score={r.feedback_score} />
                    {r.created_at && <span className="text-xs text-gray-500 whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</span>}
                  </div>
                </div>
                {r.answer_text && (
                  <div className="ml-7 rounded-lg bg-gray-900/60 border border-gray-700/40 px-3 py-2">
                    <p className="text-[10px] text-gray-500 mb-1 uppercase tracking-wider">Answer</p>
                    <p className="text-xs text-gray-300 leading-relaxed line-clamp-3">{r.answer_text}</p>
                  </div>
                )}
                {r.comment && <p className="ml-7 text-xs text-amber-300/80 italic">&ldquo;{r.comment}&rdquo;</p>}
                  </div>
                ))}
              </div>
              <Pagination page={safePage} totalPages={totalPages} onPageChange={setPage} pageSize={pageSize} onPageSizeChange={(s) => { setPageSize(s); setPage(1) }} pageSizeOptions={[10, 20, 50]} totalItems={filtered.length} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
