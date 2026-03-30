'use client'

import { useState, useEffect, useCallback } from 'react'
import Pagination from '@/components/Pagination'

interface CacheEntry {
  key: string
  request_id: string | null
  namespace: string
  query_text: string | null
  answer_snippet: string
  citations_count: number
  ttl_seconds: number
}

function TtlBadge({ ttl }: { ttl: number }) {
  const hours = Math.floor(ttl / 3600)
  const mins = Math.floor((ttl % 3600) / 60)
  const label = ttl < 0 ? 'no expiry' : hours > 0 ? `${hours}h ${mins}m` : `${mins}m`
  const color = ttl < 3600 ? 'text-red-400 border-red-800/50 bg-red-900/20'
    : ttl < 14400 ? 'text-yellow-400 border-yellow-800/50 bg-yellow-900/20'
    : 'text-green-400 border-green-800/50 bg-green-900/20'
  return (
    <span className={`text-xs px-2 py-0.5 rounded border font-mono ${color}`}>
      TTL {label}
    </span>
  )
}

export default function CacheUI() {
  const [entries, setEntries] = useState<CacheEntry[]>([])
  const [namespaces, setNamespaces] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [clearing, setClearing] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [namespace, setNamespace] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const qs = namespace ? `?namespace=${encodeURIComponent(namespace)}` : ''
      const res = await fetch(`/api/cache${qs}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setEntries(data)
      setNamespaces(Array.from(new Set((data as CacheEntry[]).map((entry) => entry.namespace))).sort())
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [namespace])

  useEffect(() => { load() }, [load])

  async function clearAll() {
    if (!confirm('Clear all semantic cache entries?')) return
    setClearing(true)
    try {
      await fetch('/api/cache', { method: 'DELETE' })
      setEntries([])
    } finally {
      setClearing(false)
    }
  }

  const filtered = search.trim()
    ? entries.filter((e) =>
        (e.query_text ?? '').toLowerCase().includes(search.toLowerCase()) ||
        (e.answer_snippet ?? '').toLowerCase().includes(search.toLowerCase())
      )
    : entries

  const avgTtl = entries.length
    ? Math.round(entries.reduce((s, e) => s + Math.max(e.ttl_seconds, 0), 0) / entries.length)
    : 0

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const paged = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  function handleSearch(v: string) { setSearch(v); setPage(1) }

  return (
    <div className="p-6 max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Semantic Cache</h1>
          <p className="text-sm text-gray-400 mt-1">
            Cached Q&amp;A pairs in Redis — reused when similar queries are detected
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="text-xs text-gray-400 hover:text-white transition-colors px-3 py-1.5 rounded-lg border border-gray-700 hover:border-gray-500">
            Refresh
          </button>
          {entries.length > 0 && (
            <button
              onClick={clearAll}
              disabled={clearing}
              className="text-xs px-3 py-1.5 rounded-lg bg-red-900/40 hover:bg-red-800/60 text-red-400 border border-red-800/50 transition-colors disabled:opacity-40"
            >
              {clearing ? 'Clearing…' : 'Clear All'}
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-4">
          <p className="text-xs text-gray-400 mb-1">Cached Entries</p>
          <p className="text-2xl font-bold text-white">{loading ? '—' : entries.length}</p>
        </div>
        <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-4">
          <p className="text-xs text-gray-400 mb-1">Avg TTL Remaining</p>
          <p className="text-2xl font-bold text-blue-400">
            {loading ? '—' : avgTtl > 3600 ? `${Math.floor(avgTtl / 3600)}h` : `${Math.floor(avgTtl / 60)}m`}
          </p>
        </div>
        <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-4">
          <p className="text-xs text-gray-400 mb-1">Namespaces</p>
          <p className="text-2xl font-bold text-purple-400">{loading ? '—' : namespaces.length}</p>
        </div>
        <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-4">
          <p className="text-xs text-gray-400 mb-1">With Query Text</p>
          <p className="text-2xl font-bold text-green-400">
            {loading ? '—' : entries.filter((e) => e.query_text).length}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">matched to log</p>
        </div>
      </div>

      {entries.length > 0 && (
        <div className="grid gap-3 md:grid-cols-[1.2fr_0.8fr]">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Search query or answer…"
              className="w-full bg-gray-800 border border-gray-700 focus:border-purple-600 rounded-lg pl-9 pr-3 py-2 text-sm text-white outline-none placeholder-gray-500"
            />
          </div>
          <input
            list="cache-namespaces"
            value={namespace}
            onChange={(e) => setNamespace(e.target.value)}
            placeholder="Filter namespace…"
            className="w-full bg-gray-800 border border-gray-700 focus:border-purple-600 rounded-lg px-3 py-2 text-sm text-white outline-none placeholder-gray-500"
          />
          <datalist id="cache-namespaces">
            {namespaces.map((ns) => (
              <option key={ns} value={ns} />
            ))}
          </datalist>
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      {loading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => <div key={i} className="h-20 bg-gray-800/40 rounded-xl animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-600">
          <svg className="w-10 h-10 mx-auto mb-3 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <p className="text-sm">{search ? 'No entries match your search' : 'Cache is empty'}</p>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {paged.map((entry) => (
              <div key={entry.key} className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-4 space-y-2">
                <div className="flex items-start gap-2">
                  <span className="text-xs text-purple-400 font-semibold mt-0.5 shrink-0">Q</span>
                  <p className="text-sm text-white">
                    {entry.query_text ?? (
                      <span className="text-gray-500 italic">Query not found in interaction log</span>
                    )}
                  </p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-xs text-green-400 font-semibold mt-0.5 shrink-0">A</span>
                  <p className="text-xs text-gray-400 leading-relaxed">{entry.answer_snippet}{entry.answer_snippet.length >= 150 ? '…' : ''}</p>
                </div>
                <div className="flex items-center gap-2 flex-wrap pt-1">
                  <TtlBadge ttl={entry.ttl_seconds} />
                  <span className="text-xs px-2 py-0.5 rounded border border-purple-700/40 bg-purple-900/20 font-mono text-purple-300">
                    {entry.namespace}
                  </span>
                  <span className="text-xs text-gray-600 font-mono">{entry.citations_count} citation{entry.citations_count !== 1 ? 's' : ''}</span>
                  <span className="text-xs text-gray-700 font-mono truncate max-w-xs">{entry.key.slice(6, 22)}…</span>
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
            pageSizeOptions={[10, 25, 50]}
            totalItems={filtered.length}
          />
        </>
      )}
    </div>
  )
}
