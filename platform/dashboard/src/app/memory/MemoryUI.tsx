'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState, useTransition } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import type { MemoryStats } from '@/types'

type Backend = 'all' | 'short' | 'long'
type SaveTarget = 'both' | 'short' | 'long'
type Tab = 'report' | 'browse' | 'add' | 'manage'

interface MemoryEntry {
  id: string
  content: string
  created_at?: string
  metadata?: Record<string, unknown>
  source?: 'short' | 'long'
}

interface MemoryUser {
  user_id: string
  entry_count: number
  last_updated?: string
}

function getRouteProfile(value: string | string[] | undefined) {
  if (!value) return ''
  return Array.isArray(value) ? value[0] ?? '' : value
}

const TAB_ITEMS: { id: Tab; label: string }[] = [
  { id: 'report', label: 'Report' },
  { id: 'browse', label: 'Browse' },
  { id: 'add', label: 'Add Memory' },
  { id: 'manage', label: 'Manage' },
]

const BACKENDS: { id: Backend; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'short', label: 'Short-term' },
  { id: 'long', label: 'Long-term' },
]

const SAVE_TARGETS: { id: SaveTarget; label: string }[] = [
  { id: 'both', label: 'Both' },
  { id: 'long', label: 'Long-term only' },
  { id: 'short', label: 'Short-term only' },
]

const inputCls = 'w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white outline-none focus:border-purple-500'
const btnCls = 'rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed'
const btnGhost = 'rounded-lg border border-gray-700 px-3 py-2 text-xs text-gray-200 hover:bg-gray-800'
const btnDanger = 'rounded-lg border border-red-700 bg-red-900/30 px-3 py-2 text-xs text-red-200 hover:bg-red-800/50 disabled:opacity-50 disabled:cursor-not-allowed'

function formatDate(value?: string) {
  if (!value) return '—'
  try {
    return new Date(value).toLocaleString()
  } catch {
    return value
  }
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-gray-700/60 bg-gray-800/70 p-4">
      <p className="text-xs uppercase tracking-wider text-gray-500">{label}</p>
      <p className="mt-2 text-2xl font-bold text-white">{value}</p>
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  )
}

function SourceBadge({ source }: { source?: string }) {
  if (source === 'short') return <span className="rounded border border-blue-700/50 bg-blue-900/30 px-2 py-0.5 text-xs font-mono text-blue-300">Short · Redis</span>
  if (source === 'long') return <span className="rounded border border-green-700/50 bg-green-900/30 px-2 py-0.5 text-xs font-mono text-green-300">Long · Postgres</span>
  return null
}

export default function MemoryUI() {
  const searchParams = useSearchParams()
  const params = useParams<{ profile?: string }>()
  const [tab, setTab] = useState<Tab>('report')
  const [backend, setBackend] = useState<Backend>('all')
  const [stats, setStats] = useState<MemoryStats | null>(null)
  const [users, setUsers] = useState<MemoryUser[]>([])
  const [reportSearch, setReportSearch] = useState('')
  const [reportLoading, setReportLoading] = useState(false)
  const [reportError, setReportError] = useState('')

  const [userId, setUserId] = useState('')
  const [loadedUser, setLoadedUser] = useState('')
  const [entries, setEntries] = useState<MemoryEntry[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [listError, setListError] = useState('')

  const [searchText, setSearchText] = useState('')
  const [filterSource, setFilterSource] = useState<'all' | 'short' | 'long'>('all')
  const [filterType, setFilterType] = useState('')
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const [addUserId, setAddUserId] = useState('')
  const [addContent, setAddContent] = useState('')
  const [addMeta, setAddMeta] = useState('')
  const [addTarget, setAddTarget] = useState<SaveTarget>('both')
  const [addError, setAddError] = useState('')
  const [saving, setSaving] = useState(false)

  const [actionMessage, setActionMessage] = useState('')
  const [copyMessage, setCopyMessage] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [clearingAll, setClearingAll] = useState(false)
  const [isPending, startTransition] = useTransition()

  async function loadReport() {
    setReportLoading(true)
    setReportError('')
    try {
      const [statsRes, usersRes] = await Promise.all([fetch('/api/memory/stats'), fetch('/api/memory/users')])
      const statsData = await statsRes.json().catch(() => null)
      const usersData = await usersRes.json().catch(() => [])
      if (!statsRes.ok) throw new Error(statsData?.detail || `HTTP ${statsRes.status}`)
      if (!usersRes.ok) throw new Error(`HTTP ${usersRes.status}`)
      setStats(statsData)
      setUsers(Array.isArray(usersData) ? usersData : [])
    } catch (err: unknown) {
      setReportError(err instanceof Error ? err.message : 'Failed to load memory report')
      setStats(null)
      setUsers([])
    } finally {
      setReportLoading(false)
    }
  }

  async function loadMemory(uid = userId, currentBackend = backend) {
    const normalized = uid.trim()
    if (!normalized) return
    setListLoading(true)
    setListError('')
    setEntries([])
    setActionMessage('')
    try {
      const res = await fetch(`/api/memory/${encodeURIComponent(normalized)}?backend=${currentBackend}`)
      const data = await res.json()
      if (!res.ok) throw new Error((data as { detail?: string }).detail || 'Failed to load memory')
      setEntries(Array.isArray(data) ? data : [])
      setLoadedUser(normalized)
    } catch (err: unknown) {
      setListError(err instanceof Error ? err.message : 'Failed to load memory')
      setLoadedUser('')
    } finally {
      setListLoading(false)
    }
  }

  const routeProfile = useMemo(() => {
    const fromParams = getRouteProfile(params?.profile)
    return decodeURIComponent((fromParams || searchParams.get('profile') || searchParams.get('user') || '').trim())
  }, [params, searchParams])

  const routeTab = useMemo(() => {
    const value = searchParams.get('tab')
    return value === 'browse' || value === 'add' || value === 'manage' ? value : ''
  }, [searchParams])

  useEffect(() => {
    void loadReport()
    if (routeProfile) {
      setUserId(routeProfile)
      setAddUserId(routeProfile)
      void loadMemory(routeProfile, backend)
      setTab(routeTab || 'browse')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeProfile, routeTab])

  const filteredUsers = useMemo(() => {
    const q = reportSearch.trim().toLowerCase()
    if (!q) return users
    return users.filter((u) => u.user_id.toLowerCase().includes(q))
  }, [users, reportSearch])

  const hasActiveProfile = !!routeProfile

  async function copyProfileKey() {
    if (!routeProfile) return
    try {
      await navigator.clipboard.writeText(routeProfile)
      setCopyMessage('Profile key copied')
      window.setTimeout(() => setCopyMessage(''), 1500)
    } catch {
      setCopyMessage('Copy failed')
      window.setTimeout(() => setCopyMessage(''), 1500)
    }
  }

  const memoryTypes = useMemo(() => {
    const s = new Set<string>()
    entries.forEach((entry) => {
      const t = entry.metadata?.memory_type as string | undefined
      if (t) s.add(t)
    })
    return Array.from(s).sort()
  }, [entries])

  const filteredEntries = useMemo(() => {
    let list = [...entries]
    if (filterSource !== 'all') list = list.filter((e) => e.source === filterSource)
    if (filterType) list = list.filter((e) => (e.metadata?.memory_type as string | undefined) === filterType)
    if (searchText.trim()) {
      const q = searchText.toLowerCase()
      list = list.filter((e) => e.content.toLowerCase().includes(q))
    }
    if (dateFrom) {
      const from = new Date(dateFrom).getTime()
      list = list.filter((e) => e.created_at && new Date(e.created_at).getTime() >= from)
    }
    if (dateTo) {
      const to = new Date(dateTo).getTime() + 86_400_000
      list = list.filter((e) => e.created_at && new Date(e.created_at).getTime() <= to)
    }
    list.sort((a, b) => {
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0
      return sortOrder === 'newest' ? tb - ta : ta - tb
    })
    return list
  }, [entries, filterSource, filterType, searchText, dateFrom, dateTo, sortOrder])

  const hasFilters = !!(searchText || filterSource !== 'all' || filterType || dateFrom || dateTo || sortOrder !== 'newest')

  async function saveMemory() {
    const normalizedUser = addUserId.trim()
    if (!normalizedUser || !addContent.trim()) return
    let metadata: Record<string, unknown> = {}
    if (addMeta.trim()) {
      try {
        metadata = JSON.parse(addMeta)
      } catch {
        setAddError('Invalid JSON')
        return
      }
    }

    setSaving(true)
    setAddError('')
    setActionMessage('')
    try {
      const res = await fetch('/api/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: normalizedUser,
          content: addContent,
          metadata: { ...metadata, _save_target: addTarget },
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.detail || data?.error || `HTTP ${res.status}`)
      setAddContent('')
      setAddMeta('')
      setActionMessage(`Saved memory for ${normalizedUser}`)
      await loadReport()
      if (loadedUser === normalizedUser) {
        await loadMemory(normalizedUser, backend)
      }
    } catch (err: unknown) {
      setAddError(err instanceof Error ? err.message : 'Failed to save memory')
    } finally {
      setSaving(false)
    }
  }

  async function deleteEntry(id: string) {
    if (!loadedUser) return
    setDeletingId(id)
    setActionMessage('')
    try {
      await fetch(`/api/memory/${encodeURIComponent(loadedUser)}/${encodeURIComponent(id)}`, { method: 'DELETE' })
      setEntries((current) => current.filter((entry) => entry.id !== id))
      setActionMessage('Memory entry deleted')
      await loadReport()
    } finally {
      setDeletingId(null)
    }
  }

  async function clearAll() {
    if (!loadedUser) return
    setClearingAll(true)
    setActionMessage('')
    try {
      await fetch(`/api/memory/${encodeURIComponent(loadedUser)}`, { method: 'DELETE' })
      setEntries([])
      setActionMessage(`Cleared memory for ${loadedUser}`)
      await loadReport()
    } finally {
      setClearingAll(false)
    }
  }

  function resetFilters() {
    setSearchText('')
    setFilterSource('all')
    setFilterType('')
    setDateFrom('')
    setDateTo('')
    setSortOrder('newest')
  }

  function showEntries(editable: boolean) {
    if (listLoading) {
      return (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-16 rounded-xl bg-gray-800/40 animate-pulse" />
          ))}
        </div>
      )
    }

    if (filteredEntries.length === 0) {
      return (
        <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-6 text-sm text-gray-400">
          {hasFilters ? 'No entries match your filters.' : 'No memory entries.'}
        </div>
      )
    }

    return (
      <div className="space-y-2">
        {filteredEntries.map((entry, idx) => {
          const memoryType =
            typeof entry.metadata?.memory_type === 'string'
              ? entry.metadata.memory_type
              : entry.metadata?.memory_type != null
                ? String(entry.metadata.memory_type)
                : ''

          return (
          <div key={entry.id} className="rounded-xl border border-gray-700/50 bg-gray-800/60 p-4">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-700 text-xs text-gray-400">
                {idx + 1}
              </span>
              <div className="min-w-0 flex-1 space-y-1.5">
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-white">{entry.content}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <SourceBadge source={entry.source} />
                  {memoryType ? (
                    <span className="rounded bg-gray-700/60 px-2 py-0.5 text-xs text-gray-400">
                      {memoryType}
                    </span>
                  ) : null}
                  <span className="font-mono text-xs text-gray-500">{entry.id.slice(0, 8)}…</span>
                  <span className="text-xs text-gray-500">{formatDate(entry.created_at)}</span>
                </div>
              </div>
              {editable && (
                <button
                  onClick={() => void deleteEntry(entry.id)}
                  disabled={deletingId === entry.id}
                  className="rounded-lg border border-red-800/50 px-3 py-1.5 text-xs text-red-300 hover:bg-red-900/20 disabled:opacity-50"
                >
                  {deletingId === entry.id ? 'Deleting…' : 'Delete'}
                </button>
              )}
            </div>
          </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-gray-800 px-6 pb-4 pt-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-white">Memory Profiles</h2>
            <p className="mt-0.5 text-xs text-gray-400">
              Report profiles here. Open a profile to browse, add, and manage memory entries.
            </p>
          </div>
          <div className="flex gap-2">
            <span className="flex items-center gap-1.5 rounded-lg border border-blue-700/40 bg-blue-900/20 px-3 py-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
              <span className="font-mono text-xs text-blue-300">Redis · 1h TTL</span>
            </span>
            <span className="flex items-center gap-1.5 rounded-lg border border-green-700/40 bg-green-900/20 px-3 py-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
              <span className="font-mono text-xs text-green-300">Postgres · permanent</span>
            </span>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-5xl space-y-5">
          {actionMessage && (
            <div className="rounded-xl border border-green-800 bg-green-900/20 p-3 text-sm text-green-400">
              {actionMessage}
            </div>
          )}

          {copyMessage && !actionMessage && (
            <div className="rounded-xl border border-gray-700 bg-gray-900/70 p-3 text-sm text-gray-300">
              {copyMessage}
            </div>
          )}

          {tab === 'report' && (
            <>
              <div className="grid gap-4 md:grid-cols-4">
                <Stat label="Short-term Users" value={stats ? String(stats.short_term_users) : '—'} hint="Redis buckets with entries" />
                <Stat label="Short-term Entries" value={stats ? String(stats.short_term_entries) : '—'} hint="Redis-backed entries" />
                <Stat label="Long-term Users" value={stats ? String(stats.long_term_users) : '—'} hint="Postgres buckets with entries" />
                <Stat label="Long-term Entries" value={stats ? String(stats.long_term_entries) : '—'} hint="Postgres-backed entries" />
              </div>

              <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-400">Memory Report</h3>
                    <p className="mt-1 text-xs text-gray-500">List of profiles currently known to the system.</p>
                  </div>
                  <button onClick={() => void loadReport()} className={btnGhost}>
                    Refresh
                  </button>
                </div>

                {reportError && <p className="mb-3 text-sm text-red-400">{reportError}</p>}

                <div className="mb-4">
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-gray-500">Search profile</label>
                  <input value={reportSearch} onChange={(e) => setReportSearch(e.target.value)} className={inputCls} placeholder="Search profile" />
                </div>

                {reportLoading ? (
                  <div className="space-y-2">
                    {[...Array(4)].map((_, i) => <div key={i} className="h-14 rounded-xl bg-gray-800/50 animate-pulse" />)}
                  </div>
                ) : filteredUsers.length === 0 ? (
                  <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-6 text-sm text-gray-400">No profiles found.</div>
                ) : (
                  <div className="overflow-hidden rounded-xl border border-gray-800">
                    <div className="grid grid-cols-[2fr_0.8fr_1fr_1.5fr] gap-4 border-b border-gray-800 bg-gray-950/80 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
                      <span>Profile</span>
                      <span>Entries</span>
                      <span>Last Updated</span>
                      <span>Actions</span>
                    </div>
                    <div className="divide-y divide-gray-800">
                      {filteredUsers.map((u) => (
                        <div key={u.user_id} className="grid grid-cols-[2fr_0.8fr_1fr_1.5fr] gap-4 px-4 py-3 text-sm items-center">
                          <span className="break-all font-mono text-white">{u.user_id}</span>
                          <span className="text-yellow-300">{u.entry_count}</span>
                          <span className="text-gray-300">{formatDate(u.last_updated)}</span>
                          <div className="flex flex-wrap gap-2">
                            <Link
                              href={`/memory/${encodeURIComponent(u.user_id)}`}
                              className={btnGhost}
                            >
                              Open
                            </Link>
                            <Link
                              href={`/memory/${encodeURIComponent(u.user_id)}?tab=add`}
                              className="rounded-lg border border-blue-700/60 px-3 py-2 text-xs text-blue-200 hover:bg-blue-900/30"
                            >
                              Add Memory
                            </Link>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {hasActiveProfile && (
            <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-5">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Selected Profile</p>
                  <h3 className="mt-1 break-all font-mono text-lg text-white">{routeProfile}</h3>
                  <p className="mt-1 text-xs text-gray-500">Use this profile to browse or add memory entries.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => void copyProfileKey()} className={btnGhost}>
                    Copy Profile Key
                  </button>
                  <Link href="/memory" className={btnGhost}>
                    Back to Overview
                  </Link>
                </div>
              </div>
            </div>
          )}

          {hasActiveProfile && (
            <div className="pt-4">
              <div className="flex gap-1 rounded-lg border border-gray-800 bg-gray-900 p-1">
                {TAB_ITEMS.filter((item) => item.id !== 'report').map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setTab(item.id)}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                      tab === item.id ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {hasActiveProfile && tab === 'browse' && (
            <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-5">
              <div className="mb-4">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-400">Browse Memory</h3>
                <p className="mt-1 text-xs text-gray-500">Inspect entries only. Use Manage to delete or clear.</p>
              </div>

              <div className="flex flex-col gap-3 md:flex-row md:items-end">
                <div className="flex-1">
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-gray-500">Profile</label>
                  <input value={userId} onChange={(e) => setUserId(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void loadMemory(userId, backend)} className={inputCls} placeholder="Enter profile" />
                </div>
                <button onClick={() => void loadMemory(userId, backend)} disabled={!userId.trim() || listLoading} className={btnCls}>
                  {listLoading ? 'Loading…' : 'Load'}
                </button>
              </div>

              {listError && <p className="mt-3 text-sm text-red-400">{listError}</p>}

              {loadedUser && (
                <>
                  <div className="mt-4 flex items-center justify-between gap-3">
                    <div className="flex gap-1 rounded-lg border border-gray-800 bg-gray-900 p-1">
                      {BACKENDS.map((item) => (
                        <button
                          key={item.id}
                          onClick={() => {
                            setBackend(item.id)
                            void loadMemory(loadedUser, item.id)
                          }}
                          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                            backend === item.id ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'
                          }`}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-gray-600">{hasFilters ? `${filteredEntries.length} / ${entries.length}` : `${entries.length} entries`}</p>
                  </div>

                  <div className="mt-4 space-y-3 border-t border-gray-700/50 pt-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-gray-500">Search & Filter</p>
                      {hasFilters && (
                        <button onClick={() => {
                          setSearchText('')
                          setFilterSource('all')
                          setFilterType('')
                          setDateFrom('')
                          setDateTo('')
                          setSortOrder('newest')
                        }} className="text-xs text-gray-500 hover:text-gray-300">
                          Reset all
                        </button>
                      )}
                    </div>
                    <div className="grid gap-2 md:grid-cols-3">
                      <div>
                        <label className="mb-1 block text-xs text-gray-500">Search</label>
                        <input value={searchText} onChange={(e) => setSearchText(e.target.value)} className={inputCls} placeholder="Search content" />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-gray-500">Source</label>
                        <select value={filterSource} onChange={(e) => setFilterSource(e.target.value as typeof filterSource)} className={inputCls}>
                          <option value="all">All sources</option>
                          <option value="short">Short (Redis)</option>
                          <option value="long">Long (Postgres)</option>
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-gray-500">Type</label>
                        <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className={inputCls}>
                          <option value="">All types</option>
                          {memoryTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                        </select>
                      </div>
                    </div>
                    <div className="grid gap-2 md:grid-cols-3">
                      <div>
                        <label className="mb-1 block text-xs text-gray-500">Sort</label>
                        <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value as 'newest' | 'oldest')} className={inputCls}>
                          <option value="newest">Newest first</option>
                          <option value="oldest">Oldest first</option>
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-gray-500">From date</label>
                        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={inputCls} />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-gray-500">To date</label>
                        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={inputCls} />
                      </div>
                    </div>
                  </div>

                  <div className="mt-5">{showEntries(false)}</div>
                </>
              )}
            </div>
          )}

          {hasActiveProfile && tab === 'add' && (
            <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-5">
              <div className="mb-4">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-400">Add Memory</h3>
                <p className="mt-1 text-xs text-gray-500">Write a memory entry to a profile bucket. This does not create a dashboard user.</p>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-gray-500">Profile</label>
                  <input value={addUserId} onChange={(e) => setAddUserId(e.target.value)} className={inputCls} placeholder="e.g. profile-123" />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-500">Save to</label>
                  <select value={addTarget} onChange={(e) => setAddTarget(e.target.value as SaveTarget)} className={inputCls}>
                    {SAVE_TARGETS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                  </select>
                </div>
              </div>

              <div className="mt-3">
                <label className="mb-1 block text-xs text-gray-500">Content</label>
                <textarea value={addContent} onChange={(e) => setAddContent(e.target.value)} rows={4} className={inputCls} placeholder="Memory content" />
              </div>

              <div className="mt-3">
                <label className="mb-1 block text-xs text-gray-500">Metadata JSON <span className="text-gray-600">(optional)</span></label>
                <input value={addMeta} onChange={(e) => { setAddMeta(e.target.value); setAddError('') }} className={inputCls} placeholder='{"memory_type":"preference"}' />
                {addError && <p className="mt-1 text-xs text-red-400">{addError}</p>}
              </div>

              <div className="mt-4 flex gap-2">
                <button onClick={() => void saveMemory()} disabled={!addUserId.trim() || !addContent.trim() || saving} className={btnCls}>
                  {saving ? 'Saving…' : 'Save Memory'}
                </button>
                <button onClick={() => { setAddUserId(''); setAddContent(''); setAddMeta(''); setAddError('') }} className={btnGhost}>
                  Clear
                </button>
              </div>
            </div>
          )}

          {hasActiveProfile && tab === 'manage' && (
            <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-5">
              <div className="mb-4">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-400">Manage Memory</h3>
                <p className="mt-1 text-xs text-gray-500">Delete entries or clear a profile bucket. This is memory management, not user management.</p>
              </div>

              <div className="flex flex-col gap-3 md:flex-row md:items-end">
                <div className="flex-1">
                  <label className="mb-1 block text-xs text-gray-500">Profile</label>
                  <input value={userId} onChange={(e) => setUserId(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void loadMemory(userId, backend)} className={inputCls} placeholder="Enter profile" />
                </div>
                <button onClick={() => void loadMemory(userId, backend)} disabled={!userId.trim() || listLoading} className={btnCls}>
                  {listLoading ? 'Loading…' : 'Load'}
                </button>
                <button onClick={() => { setTab('browse'); void loadMemory(userId, backend) }} disabled={!userId.trim() || listLoading} className={btnGhost}>
                  Browse
                </button>
              </div>

              {listError && <p className="mt-3 text-xs text-red-400">{listError}</p>}

              {loadedUser ? (
                <>
                  <div className="mt-4 flex items-center justify-between gap-3">
                    <div className="flex gap-1 rounded-lg border border-gray-800 bg-gray-900 p-1">
                      {BACKENDS.map((item) => (
                        <button
                          key={item.id}
                          onClick={() => {
                            setBackend(item.id)
                            void loadMemory(loadedUser, item.id)
                          }}
                          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                            backend === item.id ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'
                          }`}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                    {entries.length > 0 && (
                      <button onClick={() => void clearAll()} disabled={clearingAll} className={btnDanger}>
                        {clearingAll ? 'Clearing…' : 'Clear All'}
                      </button>
                    )}
                  </div>

                  <div className="mt-5">{showEntries(true)}</div>
                </>
              ) : (
                <div className="mt-4 rounded-xl border border-gray-800 bg-gray-950/60 p-6 text-sm text-gray-400">
                  Load a profile first to manage its memory entries.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
