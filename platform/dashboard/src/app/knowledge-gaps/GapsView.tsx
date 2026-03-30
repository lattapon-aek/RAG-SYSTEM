'use client'

import { useState, useMemo } from 'react'
import type { KnowledgeGap } from '@/types'
import FilterBar from '@/components/FilterBar'
import Pagination from '@/components/Pagination'
import GapActions from './GapActions'

type StatusFilter = KnowledgeGap['status'] | 'all'
type SortKey = 'occurrences_desc' | 'occurrences_asc' | 'score_asc' | 'last_seen'

const STATUS_PILLS = [
  { label: 'All', value: 'all' },
  { label: 'Open', value: 'open' },
  { label: 'In Approvals', value: 'promoted' },
  { label: 'Dismissed', value: 'ignored' },
]

const SORT_OPTIONS: { label: string; value: SortKey }[] = [
  { label: 'Occurrences ↓', value: 'occurrences_desc' },
  { label: 'Occurrences ↑', value: 'occurrences_asc' },
  { label: 'Score ↑ (worst first)', value: 'score_asc' },
  { label: 'Last Seen', value: 'last_seen' },
]

const STATUS_BADGE: Record<KnowledgeGap['status'], string> = {
  open: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  promoted: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  ignored: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
}

function ScoreBar({ score, threshold }: { score: number; threshold: number }) {
  const pct = Math.min(score * 100, 100)
  const thPct = Math.min(threshold * 100, 100)
  const barColor = pct >= 80 ? 'bg-green-500' : pct >= 60 ? 'bg-yellow-500' : 'bg-red-500'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 relative bg-gray-700 rounded-full h-1.5">
        <div className={`${barColor} h-1.5 rounded-full`} style={{ width: `${pct}%` }} />
        <div className="absolute top-0 h-1.5 w-px bg-yellow-400/70" style={{ left: `${thPct}%` }} title={`Threshold: ${thPct.toFixed(0)}%`} />
      </div>
      <span className="text-xs text-gray-400 w-10 text-right">{pct.toFixed(0)}%</span>
    </div>
  )
}

function GapDetail({ gap }: { gap: KnowledgeGap }) {
  const firstMs = new Date(gap.logged_at).getTime()
  const lastMs = new Date(gap.last_seen).getTime()
  const daySpan = Math.max(1, Math.round((lastMs - firstMs) / 86_400_000))
  const perDay = (gap.occurrence_count / daySpan).toFixed(1)
  const [copied, setCopied] = useState(false)

  function copy() {
    navigator.clipboard.writeText(gap.query_text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="mt-3 pt-3 border-t border-gray-700/60 space-y-3">
      {/* Full query + copy */}
      <div className="rounded-lg bg-gray-900/60 border border-gray-700/40 p-3 relative">
        <p className="text-xs text-gray-500 mb-1.5 uppercase tracking-wider font-semibold">Full query</p>
        <p className="text-xs text-gray-200 font-mono leading-relaxed whitespace-pre-wrap break-all">{gap.query_text}</p>
        <button
          onClick={copy}
          className="absolute top-2.5 right-2.5 text-xs text-gray-600 hover:text-gray-300 transition-colors px-2 py-0.5 rounded border border-gray-700 hover:border-gray-500"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>

      {/* Frequency stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg bg-gray-900/60 border border-gray-700/40 p-3 text-center">
          <p className="text-lg font-bold text-white">{gap.occurrence_count}</p>
          <p className="text-[10px] text-gray-500 mt-0.5">total occurrences</p>
        </div>
        <div className="rounded-lg bg-gray-900/60 border border-gray-700/40 p-3 text-center">
          <p className="text-lg font-bold text-amber-400">{perDay}</p>
          <p className="text-[10px] text-gray-500 mt-0.5">per day avg</p>
        </div>
        <div className="rounded-lg bg-gray-900/60 border border-gray-700/40 p-3 text-center">
          <p className="text-lg font-bold text-blue-400">{daySpan}</p>
          <p className="text-[10px] text-gray-500 mt-0.5">day{daySpan !== 1 ? 's' : ''} active</p>
        </div>
      </div>

      {/* Timeline */}
      <div className="space-y-1">
        <div className="flex justify-between text-[10px] text-gray-500">
          <span>First seen: {new Date(gap.logged_at).toLocaleString()}</span>
          <span>Last seen: {new Date(gap.last_seen).toLocaleString()}</span>
        </div>
        <div className="relative h-1.5 rounded-full bg-gray-700 overflow-hidden">
          <div className="absolute left-0 h-full w-2 rounded-full bg-yellow-500/60" />
          <div className="absolute right-0 h-full w-2 rounded-full bg-yellow-400" />
          <div
            className="absolute h-full bg-gradient-to-r from-yellow-500/30 to-yellow-400/60"
            style={{ left: '4px', right: '4px' }}
          />
        </div>
      </div>
    </div>
  )
}

export default function GapsView({ gaps }: { gaps: KnowledgeGap[] }) {
  const [search, setSearch] = useState('')
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [status, setStatus] = useState<StatusFilter>('all')
  const [namespace, setNamespace] = useState('')
  const [sort, setSort] = useState<SortKey>('occurrences_desc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkLoading, setBulkLoading] = useState<'promote' | 'dismiss' | null>(null)
  const [bulkMessage, setBulkMessage] = useState('')

  const filtered = useMemo(() => {
    let list = gaps
    if (status !== 'all') list = list.filter((g) => g.status === status)
    if (namespace.trim()) list = list.filter((g) => g.namespace.toLowerCase().includes(namespace.toLowerCase()))
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter((g) => g.query_text.toLowerCase().includes(q))
    }
    return [...list].sort((a, b) => {
      if (sort === 'occurrences_desc') return b.occurrence_count - a.occurrence_count
      if (sort === 'occurrences_asc') return a.occurrence_count - b.occurrence_count
      if (sort === 'score_asc') return a.top_score - b.top_score
      if (sort === 'last_seen') return new Date(b.last_seen).getTime() - new Date(a.last_seen).getTime()
      return 0
    })
  }, [gaps, search, status, namespace, sort])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const paged = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  const openSelected = Array.from(selectedIds).filter((id) => {
    const g = gaps.find((x) => x.id === id)
    return g?.status === 'open'
  })

  function reset() { setSearch(''); setStatus('all'); setNamespace(''); setSort('occurrences_desc'); setPage(1); setSelectedIds(new Set()) }
  function handleFilter(fn: () => void) { fn(); setPage(1); setSelectedIds(new Set()) }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const pageOpenGaps = paged.filter((g) => g.status === 'open')
  const allPageOpenSelected = pageOpenGaps.length > 0 && pageOpenGaps.every((g) => selectedIds.has(g.id))
  function togglePageOpen() {
    if (allPageOpenSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        pageOpenGaps.forEach((g) => next.delete(g.id))
        return next
      })
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        pageOpenGaps.forEach((g) => next.add(g.id))
        return next
      })
    }
  }

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function bulkAction(action: 'promote' | 'dismiss') {
    if (openSelected.length === 0) return
    const endpoint = action === 'promote' ? 'promote' : 'ignore'
    const label = action === 'promote' ? 'Send to Approvals' : 'Dismiss'
    if (!confirm(`${label} ${openSelected.length} gap(s)?`)) return
    setBulkLoading(action)
    setBulkMessage('')
    let ok = 0
    await Promise.allSettled(
      openSelected.map((id) =>
        fetch(`/api/knowledge-gaps/${id}/${endpoint}`, { method: 'POST' })
          .then((r) => { if (r.ok) ok++ })
      )
    )
    setBulkMessage(`${label}: ${ok} / ${openSelected.length} succeeded`)
    setBulkLoading(null)
    setSelectedIds(new Set())
  }

  return (
    <>
      <FilterBar
        search={search}
        onSearchChange={(v) => handleFilter(() => setSearch(v))}
        pills={[{
          label: 'Status',
          options: STATUS_PILLS,
          value: status,
          onChange: (v) => handleFilter(() => setStatus(v as StatusFilter)),
        }]}
        resultCount={filtered.length}
        totalCount={gaps.length}
        onReset={reset}
        extras={
          <div className="flex flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 w-16 shrink-0">Namespace</span>
              <input
                type="text"
                value={namespace}
                onChange={(e) => handleFilter(() => setNamespace(e.target.value))}
                placeholder="e.g. default"
                className="bg-gray-900 border border-gray-600 focus:border-blue-500 rounded-lg px-3 py-1 text-xs text-gray-200 placeholder-gray-500 outline-none transition-colors w-36"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 w-16 shrink-0">Sort</span>
              <div className="flex gap-1.5 flex-wrap">
                {SORT_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    onClick={() => handleFilter(() => setSort(o.value))}
                    className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                      sort === o.value
                        ? 'bg-blue-600 border-blue-500 text-white'
                        : 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600 hover:text-white'
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        }
      />

      {/* Bulk action bar — appears only when something is selected */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-gray-700 bg-gray-800/80 px-3 py-2 text-xs">
          <span className="text-gray-400 mr-1">{openSelected.length} selected</span>
          <button
            onClick={togglePageOpen}
            className="px-2.5 py-1 rounded-md bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors"
          >
            {allPageOpenSelected ? 'Deselect page' : `+ Page (${pageOpenGaps.length})`}
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="px-2.5 py-1 rounded-md text-gray-500 hover:text-gray-300 transition-colors"
          >
            Clear
          </button>
          <div className="ml-auto flex gap-2">
            <button
              onClick={() => bulkAction('dismiss')}
              disabled={bulkLoading !== null || openSelected.length === 0}
              className="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors disabled:opacity-40"
            >
              {bulkLoading === 'dismiss' ? 'Dismissing…' : 'Dismiss'}
            </button>
            <button
              onClick={() => bulkAction('promote')}
              disabled={bulkLoading !== null || openSelected.length === 0}
              className="px-3 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-600 text-white transition-colors disabled:opacity-40"
            >
              {bulkLoading === 'promote' ? 'Promoting…' : 'Send to Approvals'}
            </button>
          </div>
        </div>
      )}
      {bulkMessage && (
        <p className="text-xs text-green-400 px-1">{bulkMessage}</p>
      )}

      {paged.length === 0 ? (
        <div className="bg-gray-800 rounded-xl p-12 border border-gray-700 text-center">
          <svg className="w-10 h-10 mx-auto mb-3 text-gray-600 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <p className="text-gray-400 text-sm">No knowledge gaps match your filters.</p>
        </div>
      ) : (
        <>
          <div className="grid gap-4">
            {paged.map((gap) => (
              <div key={gap.id} className={`relative bg-gray-800 rounded-xl p-5 border transition-all ${selectedIds.has(gap.id) ? 'border-blue-600/60' : 'border-gray-700'}`}>
                {gap.status === 'open' && (
                  <div className="absolute top-5 left-5">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(gap.id)}
                      onChange={() => toggleSelect(gap.id)}
                      className="rounded border-gray-600 bg-gray-800 text-blue-600 focus:ring-blue-500 focus:ring-offset-0"
                    />
                  </div>
                )}
                <div className={`${gap.status === 'open' ? 'pl-6' : ''}`}>
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <p className="text-sm text-gray-200 leading-relaxed flex-1 font-mono">{gap.query_text}</p>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${STATUS_BADGE[gap.status]}`}>
                        {gap.status === 'promoted' ? 'In Approvals' : gap.status === 'ignored' ? 'Dismissed' : 'Open'}
                      </span>
                      <span className="text-xs bg-gray-700 text-gray-300 px-2 py-1 rounded-full" title="Times this query was seen">
                        {gap.occurrence_count} seen
                      </span>
                    </div>
                  </div>
                  <div className="mb-3">
                    <p className="text-xs text-gray-500 mb-1">
                      Best score vs threshold ({(gap.threshold * 100).toFixed(0)}% line)
                    </p>
                    <ScoreBar score={gap.top_score} threshold={gap.threshold} />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex gap-4 text-xs text-gray-500">
                      <span>ns: {gap.namespace}</span>
                      <span>first: {new Date(gap.logged_at).toLocaleDateString()}</span>
                      <span>last: {new Date(gap.last_seen).toLocaleDateString()}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => toggleExpand(gap.id)}
                        className="text-xs text-gray-500 hover:text-gray-300 transition-colors flex items-center gap-1"
                      >
                        <svg className={`w-3 h-3 transition-transform ${expandedIds.has(gap.id) ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                        {expandedIds.has(gap.id) ? 'Less' : 'Details'}
                      </button>
                      {gap.status === 'open' && <GapActions id={gap.id} />}
                    </div>
                  </div>
                  {expandedIds.has(gap.id) && <GapDetail gap={gap} />}
                </div>
              </div>
            ))}
          </div>

          <Pagination
            page={safePage}
            totalPages={totalPages}
            onPageChange={setPage}
            pageSize={pageSize}
            onPageSizeChange={(s) => { setPageSize(s); setPage(1) }}
            totalItems={filtered.length}
          />
        </>
      )}
    </>
  )
}
