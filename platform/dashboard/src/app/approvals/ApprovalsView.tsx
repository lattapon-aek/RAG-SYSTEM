'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import type { KnowledgeCandidate } from '@/types'
import FilterBar from '@/components/FilterBar'
import Pagination from '@/components/Pagination'

type Status = KnowledgeCandidate['status'] | 'all'
type SourceKey = Exclude<KnowledgeCandidate['source_type'], undefined>
type SourceFilter = SourceKey | 'all'
type SortKey = 'newest' | 'oldest' | 'conf_asc' | 'conf_desc'

const STATUS_PILLS = [
  { label: 'All', value: 'all' },
  { label: 'Pending', value: 'pending' },
  { label: 'Approved', value: 'approved' },
  { label: 'Rejected', value: 'rejected' },
  { label: 'Expired', value: 'expired' },
]

const SORT_OPTIONS: { label: string; value: SortKey }[] = [
  { label: 'Newest', value: 'newest' },
  { label: 'Oldest', value: 'oldest' },
  { label: 'Confidence ↑', value: 'conf_asc' },
  { label: 'Confidence ↓', value: 'conf_desc' },
]

const SOURCE_PILLS = [
  { label: 'All', value: 'all' },
  { label: 'Interaction', value: 'interaction' },
  { label: 'Feedback', value: 'feedback' },
  { label: 'Feedback Cluster', value: 'feedback_cluster' },
  { label: 'Knowledge Gap', value: 'knowledge_gap' },
  { label: 'Text Ingest', value: 'text_ingest' },
  { label: 'Web Ingest', value: 'web_ingest' },
  { label: 'File Ingest', value: 'file_ingest' },
  { label: 'Knowledge Harvest', value: 'knowledge_harvest' },
  { label: 'Manual', value: 'manual' },
]

const STATUS_COLORS: Record<KnowledgeCandidate['status'], string> = {
  pending: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  approved: 'bg-green-500/20 text-green-400 border-green-500/30',
  rejected: 'bg-red-500/20 text-red-400 border-red-500/30',
  expired: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
}

function ConfidenceBar({ score }: { score: number }) {
  const pct = Math.min(Math.max(score * 100, 0), 100)
  const color = pct >= 80 ? 'bg-green-500' : pct >= 60 ? 'bg-yellow-500' : 'bg-red-500'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-gray-700 rounded-full h-1.5">
        <div className={`${color} h-1.5 rounded-full`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-medium text-gray-300 w-10 text-right">{pct.toFixed(0)}%</span>
    </div>
  )
}

export default function ApprovalsView({ candidates }: { candidates: KnowledgeCandidate[] }) {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<Status>('all')
  const [source, setSource] = useState<SourceFilter>('all')
  const [sort, setSort] = useState<SortKey>('newest')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkLoading, setBulkLoading] = useState<'approve' | 'reject' | null>(null)
  const [bulkMessage, setBulkMessage] = useState('')

  const filtered = useMemo(() => {
    let list = candidates
    if (status !== 'all') list = list.filter((c) => c.status === status)
    if (source !== 'all') list = list.filter((c) => (c.source_type ?? 'interaction') === source)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter((c) => c.proposed_content.toLowerCase().includes(q))
    }
    return [...list].sort((a, b) => {
      if (sort === 'newest') return new Date(b.proposed_at ?? b.created_at).getTime() - new Date(a.proposed_at ?? a.created_at).getTime()
      if (sort === 'oldest') return new Date(a.proposed_at ?? a.created_at).getTime() - new Date(b.proposed_at ?? b.created_at).getTime()
      if (sort === 'conf_asc') return a.confidence_score - b.confidence_score
      if (sort === 'conf_desc') return b.confidence_score - a.confidence_score
      return 0
    })
  }, [candidates, search, status, source, sort])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const paged = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  const pendingSelected = Array.from(selectedIds).filter((id) => {
    const c = candidates.find((x) => x.id === id)
    return c?.status === 'pending'
  })

  function reset() { setSearch(''); setStatus('all'); setSource('all'); setSort('newest'); setPage(1); setSelectedIds(new Set()) }
  function handleFilter(fn: () => void) { fn(); setPage(1); setSelectedIds(new Set()) }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const pageAllPending = paged.filter((c) => c.status === 'pending')
  const allPagePendingSelected = pageAllPending.length > 0 && pageAllPending.every((c) => selectedIds.has(c.id))
  function togglePagePending() {
    if (allPagePendingSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        pageAllPending.forEach((c) => next.delete(c.id))
        return next
      })
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        pageAllPending.forEach((c) => next.add(c.id))
        return next
      })
    }
  }

  async function bulkAction(action: 'approve' | 'reject') {
    if (pendingSelected.length === 0) return
    if (!confirm(`${action === 'approve' ? 'Approve' : 'Reject'} ${pendingSelected.length} candidate(s)?`)) return
    setBulkLoading(action)
    setBulkMessage('')
    let ok = 0
    await Promise.allSettled(
      pendingSelected.map((id) =>
        fetch(`/api/approvals/${id}/${action}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(action === 'approve' ? { content: candidates.find((c) => c.id === id)?.proposed_content } : {}),
        }).then((r) => { if (r.ok) ok++ })
      )
    )
    setBulkMessage(`${action === 'approve' ? 'Approved' : 'Rejected'} ${ok} / ${pendingSelected.length}`)
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
          onChange: (v) => handleFilter(() => setStatus(v as Status)),
        }, {
          label: 'Source',
          options: SOURCE_PILLS,
          value: source,
          onChange: (v) => handleFilter(() => setSource(v as SourceFilter)),
        }]}
        resultCount={filtered.length}
        totalCount={candidates.length}
        onReset={reset}
        extras={
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
        }
      />

      {/* Bulk action bar — appears only when something is selected */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-gray-700 bg-gray-800/80 px-3 py-2 text-xs">
          <span className="text-gray-400 mr-1">{pendingSelected.length} selected</span>
          <button
            onClick={togglePagePending}
            className="px-2.5 py-1 rounded-md bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors"
          >
            {allPagePendingSelected ? 'Deselect page' : `+ Page (${pageAllPending.length})`}
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="px-2.5 py-1 rounded-md text-gray-500 hover:text-gray-300 transition-colors"
          >
            Clear
          </button>
          <div className="ml-auto flex gap-2">
            <button
              onClick={() => bulkAction('reject')}
              disabled={bulkLoading !== null || pendingSelected.length === 0}
              className="px-3 py-1.5 rounded-lg bg-red-900/50 hover:bg-red-800/70 text-red-300 border border-red-800/40 transition-colors disabled:opacity-40"
            >
              {bulkLoading === 'reject' ? 'Rejecting…' : 'Reject'}
            </button>
            <button
              onClick={() => bulkAction('approve')}
              disabled={bulkLoading !== null || pendingSelected.length === 0}
              className="px-3 py-1.5 rounded-lg bg-green-700 hover:bg-green-600 text-white transition-colors disabled:opacity-40"
            >
              {bulkLoading === 'approve' ? 'Approving…' : 'Approve'}
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
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-gray-400 text-sm">No candidates match your filters.</p>
        </div>
      ) : (
        <>
          <div className="grid gap-4">
            {paged.map((c) => {
              const truncated = c.proposed_content.length > 200
                ? c.proposed_content.slice(0, 200) + '...'
                : c.proposed_content
              const isPending = c.status === 'pending'
              const isSelected = selectedIds.has(c.id)
              return (
                <div key={c.id} className={`relative bg-gray-800 rounded-xl border transition-all ${isSelected ? 'border-purple-600/60' : 'border-gray-700'}`}>
                  {isPending && (
                    <div className="absolute top-4 left-4 z-10">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(c.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="rounded border-gray-600 bg-gray-800 text-purple-600 focus:ring-purple-500 focus:ring-offset-0"
                      />
                    </div>
                  )}
                  <Link
                    href={`/approvals/${c.id}`}
                    className={`block p-5 hover:border-gray-600 transition-all ${isPending ? 'pl-10' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-4 mb-3">
                      <div className="flex-1 min-w-0">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full border bg-gray-900/80 text-gray-300 border-gray-700`}>
                            {(c.source_type ?? 'interaction').replace(/_/g, ' ')}
                          </span>
                          {c.source_title && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full border bg-cyan-900/25 text-cyan-200 border-cyan-700/40 truncate max-w-[24rem]">
                              {c.source_title}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-200 leading-relaxed">{truncated}</p>
                      </div>
                      <span className={`shrink-0 text-xs font-medium px-2.5 py-1 rounded-full border ${STATUS_COLORS[c.status]}`}>
                        {c.status}
                      </span>
                    </div>
                    <div className="space-y-2">
                      <div>
                        <p className="text-xs text-gray-500 mb-1">Confidence Score</p>
                        <ConfidenceBar score={c.confidence_score} />
                      </div>
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-gray-500">
                          Proposed: {new Date(c.proposed_at ?? c.created_at).toLocaleString()}
                        </p>
                        <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-purple-900/30 border border-purple-700/40 text-purple-300">
                          → {c.target_namespace ?? 'default'}
                        </span>
                      </div>
                    </div>
                  </Link>
                </div>
              )
            })}
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
