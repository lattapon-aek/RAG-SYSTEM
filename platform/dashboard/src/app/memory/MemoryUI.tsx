'use client'

import { useState, useMemo, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'

type Backend = 'all' | 'short' | 'long'
type SaveTarget = 'both' | 'short' | 'long'
type SortOrder = 'newest' | 'oldest'

interface MemoryEntry {
  id: string
  content: string
  created_at?: string
  metadata?: Record<string, unknown>
  source?: 'short' | 'long'
}

const inputCls = 'w-full bg-gray-800 border border-gray-700 focus:border-purple-600 rounded-lg px-3 py-2 text-sm text-white outline-none transition-colors placeholder-gray-500'
const btnPrimary = 'px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm rounded-lg transition-colors font-medium'
const btnDanger = 'px-3 py-1.5 bg-red-900/40 hover:bg-red-800/60 text-red-400 border border-red-800/50 text-xs rounded-lg transition-colors'
const btnSecondary = 'px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm rounded-lg transition-colors'

function formatDate(s?: string) {
  if (!s) return '—'
  try { return new Date(s).toLocaleString() } catch { return s }
}

function SourceBadge({ source }: { source?: string }) {
  if (source === 'short') return (
    <span className="text-xs px-2 py-0.5 rounded border font-mono bg-blue-900/30 text-blue-400 border-blue-700/50">
      Short · Redis
    </span>
  )
  if (source === 'long') return (
    <span className="text-xs px-2 py-0.5 rounded border font-mono bg-green-900/30 text-green-400 border-green-700/50">
      Long · Postgres
    </span>
  )
  return null
}

const TAB_CONFIG: { id: Backend; label: string; desc: string }[] = [
  { id: 'all',   label: 'All',        desc: 'Short-term + Long-term combined' },
  { id: 'short', label: 'Short-term', desc: 'Redis · TTL 1h · session context' },
  { id: 'long',  label: 'Long-term',  desc: 'Postgres · permanent · preferences & facts' },
]

const SAVE_TARGET_CONFIG: { id: SaveTarget; label: string }[] = [
  { id: 'both',  label: 'Both (Short + Long)' },
  { id: 'long',  label: 'Long-term only (Postgres)' },
  { id: 'short', label: 'Short-term only (Redis)' },
]

export default function MemoryUI() {
  // Browse state
  const [browseUserId, setBrowseUserId] = useState('')
  const [loadedUser, setLoadedUser] = useState('')
  const [tab, setTab] = useState<Backend>('all')
  const [entries, setEntries] = useState<MemoryEntry[]>([])
  const [loadingList, setLoadingList] = useState(false)
  const [listError, setListError] = useState('')

  // Search & filter (always visible once browseUserId is set)
  const [searchText, setSearchText] = useState('')
  const [filterSource, setFilterSource] = useState<'all' | 'short' | 'long'>('all')
  const [filterMemoryType, setFilterMemoryType] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest')

  // Add form state
  const [showAdd, setShowAdd] = useState(false)
  const [addUserId, setAddUserId] = useState('')
  const [addContent, setAddContent] = useState('')
  const [addMeta, setAddMeta] = useState('')
  const [addMetaError, setAddMetaError] = useState('')
  const [saveTarget, setSaveTarget] = useState<SaveTarget>('both')
  const [saving, setSaving] = useState(false)

  // Deleting
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [clearingAll, setClearingAll] = useState(false)

  const searchParams = useSearchParams()

  useEffect(() => {
    const u = searchParams.get('user')
    if (u) {
      setBrowseUserId(u)
      setAddUserId(u)
      loadMemory(u, tab)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const memoryTypes = useMemo(() => {
    const types = new Set<string>()
    entries.forEach((e) => {
      const t = e.metadata?.memory_type as string | undefined
      if (t) types.add(t)
    })
    return Array.from(types).sort()
  }, [entries])

  const filtered = useMemo(() => {
    let result = [...entries]
    if (filterSource !== 'all') result = result.filter((e) => e.source === filterSource)
    if (filterMemoryType) result = result.filter((e) => (e.metadata?.memory_type as string | undefined) === filterMemoryType)
    if (searchText.trim()) {
      const q = searchText.toLowerCase()
      result = result.filter((e) => e.content.toLowerCase().includes(q))
    }
    if (dateFrom) {
      const from = new Date(dateFrom).getTime()
      result = result.filter((e) => e.created_at && new Date(e.created_at).getTime() >= from)
    }
    if (dateTo) {
      const to = new Date(dateTo).getTime() + 86400000
      result = result.filter((e) => e.created_at && new Date(e.created_at).getTime() <= to)
    }
    result.sort((a, b) => {
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0
      return sortOrder === 'newest' ? tb - ta : ta - tb
    })
    return result
  }, [entries, filterSource, filterMemoryType, searchText, dateFrom, dateTo, sortOrder])

  function resetFilters() {
    setSearchText(''); setFilterSource('all'); setFilterMemoryType('')
    setDateFrom(''); setDateTo(''); setSortOrder('newest')
  }

  const hasActiveFilter = !!(searchText || filterSource !== 'all' || filterMemoryType || dateFrom || dateTo || sortOrder !== 'newest')

  async function loadMemory(uid = browseUserId, backend = tab) {
    const u = uid.trim()
    if (!u) return
    setLoadingList(true); setListError(''); setEntries([])
    try {
      const res = await fetch(`/api/memory/${encodeURIComponent(u)}?backend=${backend}`)
      const data = await res.json()
      if (!res.ok) { setListError((data as { detail?: string }).detail ?? 'Failed to load'); return }
      setEntries(Array.isArray(data) ? data : [])
      setLoadedUser(u)
    } catch (e: unknown) {
      setListError(e instanceof Error ? e.message : 'Request failed')
    } finally {
      setLoadingList(false)
    }
  }

  async function switchTab(t: Backend) {
    setTab(t)
    if (loadedUser) await loadMemory(loadedUser, t)
  }

  async function deleteEntry(memoryId: string) {
    setDeletingId(memoryId)
    try {
      await fetch(`/api/memory/${encodeURIComponent(loadedUser)}/${encodeURIComponent(memoryId)}`, { method: 'DELETE' })
      setEntries((prev) => prev.filter((e) => e.id !== memoryId))
    } finally {
      setDeletingId(null)
    }
  }

  async function clearAll() {
    if (!loadedUser) return
    setClearingAll(true)
    try {
      await fetch(`/api/memory/${encodeURIComponent(loadedUser)}`, { method: 'DELETE' })
      setEntries([])
    } finally {
      setClearingAll(false)
    }
  }

  async function saveEntry() {
    const uid = addUserId.trim()
    if (!addContent.trim() || !uid) return
    let metadata: Record<string, unknown> = {}
    if (addMeta.trim()) {
      try { metadata = JSON.parse(addMeta) } catch {
        setAddMetaError('Invalid JSON'); return
      }
    }
    const targetMap: Record<SaveTarget, string> = { both: 'composite', long: 'postgres', short: 'redis' }
    setAddMetaError(''); setSaving(true)
    try {
      const res = await fetch('/api/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: uid,
          content: addContent,
          metadata: { ...metadata, _save_target: targetMap[saveTarget] },
        }),
      })
      if (res.ok) {
        const data = await res.json() as { memory_id?: string }
        // If browsing the same user, prepend to list
        if (uid === loadedUser) {
          const source: 'short' | 'long' = saveTarget === 'short' ? 'short' : 'long'
          setEntries((prev) => [{
            id: data.memory_id ?? crypto.randomUUID(),
            content: addContent,
            metadata: { ...metadata },
            created_at: new Date().toISOString(),
            source,
          }, ...prev])
        }
        setAddContent(''); setAddMeta('')
      }
    } finally {
      setSaving(false)
    }
  }

  const shortCount = entries.filter((e) => e.source === 'short').length
  const longCount  = entries.filter((e) => e.source === 'long').length

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 pt-6 pb-4 border-b border-gray-800">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-white">Memory Manager</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Manage memory entries by user_id. The user_id is only the lookup key, not a user account record.
            </p>
          </div>
          <div className="flex gap-2">
            <span className="flex items-center gap-1.5 bg-blue-900/20 border border-blue-700/40 rounded-lg px-3 py-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
              <span className="text-xs text-blue-300 font-mono">Redis · 1h TTL</span>
            </span>
            <span className="flex items-center gap-1.5 bg-green-900/20 border border-green-700/40 rounded-lg px-3 py-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
              <span className="text-xs text-green-300 font-mono">Postgres · permanent</span>
            </span>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl space-y-5">

          {/* ── Add Memory (toggle) ── */}
          <div className="bg-gray-800/40 border border-gray-700/50 rounded-xl overflow-hidden">
            <button
              onClick={() => setShowAdd((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-700/30 transition-colors"
            >
              <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider">+ Add Memory</span>
              <svg
                className={`w-4 h-4 text-gray-500 transition-transform ${showAdd ? 'rotate-180' : ''}`}
                fill="none" stroke="currentColor" viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {showAdd && (
              <div className="px-4 pb-4 space-y-3 border-t border-gray-700/50">

                {/* Quick sample presets */}
                <div className="pt-3">
                  <p className="text-xs text-gray-500 mb-2">Quick samples — click to prefill:</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {([
                      {
                        label: '💬 Conversation',
                        desc: 'Q&A pair · short',
                        userId: 'user_001',
                        content: 'Q: What is RAG?\nA: RAG (Retrieval-Augmented Generation) combines vector search with LLM generation to answer questions using your own documents.',
                        target: 'short' as SaveTarget,
                        meta: '{"memory_type":"conversation"}',
                      },
                      {
                        label: '📌 Preference',
                        desc: 'User pref · long',
                        userId: 'user_001',
                        content: 'User prefers Thai-language responses. Always answer in Thai unless explicitly asked otherwise.',
                        target: 'long' as SaveTarget,
                        meta: '{"memory_type":"preference"}',
                      },
                      {
                        label: '🔖 Session Context',
                        desc: 'Context · short',
                        userId: 'user_002',
                        content: 'User is researching microservices architecture. Previous session covered Docker Compose, service discovery, and API gateway patterns.',
                        target: 'short' as SaveTarget,
                        meta: '{"memory_type":"session_context"}',
                      },
                      {
                        label: '🗄 Long-term Fact',
                        desc: 'Profile · long',
                        userId: 'user_002',
                        content: 'User is a senior backend engineer at a fintech company. Works primarily with Python and PostgreSQL.',
                        target: 'long' as SaveTarget,
                        meta: '{"memory_type":"user_profile"}',
                      },
                      {
                        label: '📋 Task Summary',
                        desc: 'Summary · both',
                        userId: 'user_001',
                        content: 'User completed onboarding flow. Configured namespace "fintech-kb" with 3 documents. Asked 12 queries this session.',
                        target: 'both' as SaveTarget,
                        meta: '{"memory_type":"task_summary"}',
                      },
                      {
                        label: '⚙️ System Note',
                        desc: 'Config · long',
                        userId: 'user_003',
                        content: 'User has access to namespaces: default, hr-docs, legal-kb. Default language: English. Preferred response style: concise bullet points.',
                        target: 'long' as SaveTarget,
                        meta: '{"memory_type":"system_note"}',
                      },
                    ] as { label: string; desc: string; userId: string; content: string; target: SaveTarget; meta: string }[]).map((s) => (
                      <button
                        key={s.label}
                        onClick={() => {
                          setAddUserId(s.userId)
                          setAddContent(s.content)
                          setSaveTarget(s.target)
                          setAddMeta(s.meta)
                          setAddMetaError('')
                        }}
                        className="text-left px-2.5 py-2 rounded-lg bg-gray-900/60 hover:bg-gray-700/60 border border-gray-700 hover:border-gray-500 transition-colors"
                      >
                        <div className="text-xs text-gray-200 font-medium">{s.label}</div>
                        <div className="text-[10px] text-gray-600 mt-0.5">{s.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">user_id</label>
                    <input
                      value={addUserId}
                      onChange={(e) => setAddUserId(e.target.value)}
                      placeholder="e.g. user123"
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Save to</label>
                    <select value={saveTarget} onChange={(e) => setSaveTarget(e.target.value as SaveTarget)} className={`${inputCls} cursor-pointer`}>
                      {SAVE_TARGET_CONFIG.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-xs text-gray-400 block mb-1">Content</label>
                  <textarea
                    value={addContent}
                    onChange={(e) => setAddContent(e.target.value)}
                    rows={3}
                    placeholder="e.g. User prefers concise answers in Thai"
                    className={`${inputCls} resize-none`}
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-400 block mb-1">Metadata JSON <span className="text-gray-600">(optional)</span></label>
                  <input
                    value={addMeta}
                    onChange={(e) => { setAddMeta(e.target.value); setAddMetaError('') }}
                    placeholder='{"memory_type": "preference"}'
                    className={inputCls}
                  />
                  {addMetaError && <p className="text-xs text-red-400 mt-1">{addMetaError}</p>}
                </div>

                <button
                  onClick={saveEntry}
                  disabled={!addContent.trim() || !addUserId.trim() || saving}
                  className={btnPrimary}
                >
                  {saving ? 'Saving…' : 'Save Memory'}
                </button>
              </div>
            )}
          </div>

          {/* ── Browse Memory ── */}
          <div className="bg-gray-800/40 border border-gray-700/50 rounded-xl p-4 space-y-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Browse Memory by user_id</p>

            {/* User lookup row */}
            <div className="flex gap-2">
              <input
                value={browseUserId}
                onChange={(e) => setBrowseUserId(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && loadMemory(browseUserId, tab)}
                placeholder="Enter user_id to load entries…"
                className={inputCls}
              />
              <button
                onClick={() => loadMemory(browseUserId, tab)}
                disabled={!browseUserId.trim() || loadingList}
                className={btnPrimary}
              >
                {loadingList ? 'Loading…' : 'Load'}
              </button>
            </div>
            {listError && <p className="text-xs text-red-400">{listError}</p>}

            {/* ── Search & Filter (always visible) ── */}
            <div className="space-y-3 pt-1 border-t border-gray-700/50">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-500 font-medium">Search & Filter</p>
                  {hasActiveFilter && (
                    <button onClick={resetFilters} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
                      Reset all
                    </button>
                  )}
                </div>

                {/* Text search */}
                <div className="relative">
                  <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input
                    value={searchText}
                    onChange={(e) => setSearchText(e.target.value)}
                    placeholder="Search content…"
                    className={`${inputCls} pl-8`}
                  />
                  {searchText && (
                    <button onClick={() => setSearchText('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {tab === 'all' && (
                    <div>
                      <label className="text-xs text-gray-500 block mb-1">Source</label>
                      <select value={filterSource} onChange={(e) => setFilterSource(e.target.value as typeof filterSource)} className={`${inputCls} cursor-pointer text-xs py-1.5`}>
                        <option value="all">All sources</option>
                        <option value="short">Short (Redis)</option>
                        <option value="long">Long (Postgres)</option>
                      </select>
                    </div>
                  )}
                  {memoryTypes.length > 0 && (
                    <div>
                      <label className="text-xs text-gray-500 block mb-1">Type</label>
                      <select value={filterMemoryType} onChange={(e) => setFilterMemoryType(e.target.value)} className={`${inputCls} cursor-pointer text-xs py-1.5`}>
                        <option value="">All types</option>
                        {memoryTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                  )}
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Sort</label>
                    <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value as SortOrder)} className={`${inputCls} cursor-pointer text-xs py-1.5`}>
                      <option value="newest">Newest first</option>
                      <option value="oldest">Oldest first</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">From date</label>
                    <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={`${inputCls} text-xs py-1.5`} />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">To date</label>
                    <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={`${inputCls} text-xs py-1.5`} />
                  </div>
                </div>
              </div>
          </div>

          {/* ── Entry list (only after load) ── */}
          {loadedUser && (
            <div>
              {/* Tab bar + Clear All */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex gap-1 bg-gray-900 rounded-lg p-1 border border-gray-800">
                  {TAB_CONFIG.map((t) => {
                    const count = t.id === 'short' ? shortCount : t.id === 'long' ? longCount : entries.length
                    return (
                      <button
                        key={t.id}
                        onClick={() => switchTab(t.id)}
                        title={t.desc}
                        className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                          tab === t.id ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'
                        }`}
                      >
                        {t.label}
                        {count > 0 && <span className="ml-1.5 text-gray-400">({count})</span>}
                      </button>
                    )
                  })}
                </div>
                <div className="flex items-center gap-2">
                  <p className="text-xs text-gray-600">
                    {hasActiveFilter ? `${filtered.length} / ${entries.length}` : `${entries.length} entries`}
                  </p>
                  {entries.length > 0 && (
                    <button onClick={clearAll} disabled={clearingAll} className={btnDanger}>
                      {clearingAll ? 'Clearing…' : 'Clear All'}
                    </button>
                  )}
                </div>
              </div>

              {loadingList ? (
                <div className="space-y-2">
                  {[...Array(4)].map((_, i) => <div key={i} className="h-16 bg-gray-800/40 rounded-xl animate-pulse" />)}
                </div>
              ) : filtered.length === 0 ? (
                <div className="text-center py-10 text-gray-600">
                  <p className="text-sm">{hasActiveFilter ? 'No entries match your filters' : 'No memory entries'}</p>
                  {hasActiveFilter && (
                    <button onClick={resetFilters} className="text-xs text-purple-400 hover:text-purple-300 mt-2">Clear filters</button>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  {filtered.map((entry, idx) => {
                    const cleanMeta = Object.fromEntries(
                      Object.entries(entry.metadata ?? {}).filter(([k]) => k !== '_save_target')
                    ) as Record<string, string | number | boolean | null | undefined>
                    return (
                      <div key={entry.id} className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-4 group">
                        <div className="flex items-start gap-3">
                          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-gray-700 text-gray-400 text-xs flex items-center justify-center mt-0.5">
                            {idx + 1}
                          </span>
                          <div className="flex-1 min-w-0 space-y-1.5">
                            <p className="text-sm text-white leading-relaxed whitespace-pre-wrap break-words">
                              {searchText.trim()
                                ? entry.content.split(new RegExp(`(${searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')).map((part, i) =>
                                    part.toLowerCase() === searchText.toLowerCase()
                                      ? <mark key={i} className="bg-yellow-500/30 text-yellow-200 rounded">{part}</mark>
                                      : part
                                  )
                                : entry.content}
                            </p>
                            <div className="flex items-center gap-2 flex-wrap">
                              <SourceBadge source={entry.source} />
                              {cleanMeta.memory_type && (
                                <span className="text-xs px-2 py-0.5 rounded bg-gray-700/60 text-gray-400 border border-gray-600/50">
                                  {String(cleanMeta.memory_type)}
                                </span>
                              )}
                              <span className="text-xs text-gray-500 font-mono">{entry.id.slice(0, 8)}…</span>
                              <span className="text-xs text-gray-500">{formatDate(entry.created_at)}</span>
                            </div>
                          </div>
                          <button
                            onClick={() => deleteEntry(entry.id)}
                            disabled={deletingId === entry.id}
                            className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 text-gray-600 hover:text-red-400 rounded-lg hover:bg-red-900/20"
                            title="Delete"
                          >
                            {deletingId === entry.id ? (
                              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                              </svg>
                            ) : (
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            )}
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {!loadedUser && !loadingList && !browseUserId.trim() && (
            <div className="text-center py-10 text-gray-600">
              <svg className="w-10 h-10 mx-auto mb-3 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              <p className="text-sm">Enter a user_id above to browse or add memory entries</p>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
