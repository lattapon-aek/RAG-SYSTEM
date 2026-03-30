'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState, useTransition } from 'react'

interface MemoryProfileRecord {
  user_id: string
  entry_count: number
  last_updated: string | null
  label: string | null
  notes: string | null
  created_at: string | null
  created_by: string | null
}

const inputCls = 'w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white outline-none focus:border-purple-500'
const btnCls = 'rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed'
const btnGhost = 'rounded-lg border border-gray-700 px-3 py-2 text-xs text-gray-200 hover:bg-gray-800'
const btnDanger = 'rounded-lg border border-red-700 bg-red-900/30 px-3 py-2 text-xs text-red-200 hover:bg-red-800/50 disabled:opacity-50 disabled:cursor-not-allowed'

function fmtDate(value: string | null) {
  if (!value) return '—'
  try {
    return new Date(value).toLocaleString()
  } catch {
    return value
  }
}

export default function MemoryProfilesUI() {
  const [profiles, setProfiles] = useState<MemoryProfileRecord[]>([])
  const [search, setSearch] = useState('')
  const [profileKey, setProfileKey] = useState('')
  const [label, setLabel] = useState('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

  async function loadProfiles() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/memory/users', { cache: 'no-store' })
      const data = await res.json().catch(() => [])
      if (!res.ok) throw new Error(data?.error || data?.detail || `HTTP ${res.status}`)
      setProfiles(Array.isArray(data) ? data : [])
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load memory profiles')
      setProfiles([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadProfiles()
  }, [])

  const filteredProfiles = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return profiles
    return profiles.filter((profile) =>
      [profile.user_id, profile.label ?? '', profile.notes ?? '', profile.created_by ?? '']
        .join(' ')
        .toLowerCase()
        .includes(q),
    )
  }, [profiles, search])

  const totals = useMemo(() => {
    return {
      profiles: profiles.length,
      withEntries: profiles.filter((profile) => profile.entry_count > 0).length,
      entries: profiles.reduce((sum, profile) => sum + profile.entry_count, 0),
    }
  }, [profiles])

  async function createProfile() {
    const normalized = profileKey.trim()
    if (!normalized) {
      setError('Profile key is required')
      return
    }

    setCreating(true)
    setError('')
    setMessage('')
    try {
      const res = await fetch('/api/memory/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: normalized,
          label: label.trim() || null,
          notes: notes.trim() || null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || data?.detail || `HTTP ${res.status}`)

      setProfileKey('')
      setLabel('')
      setNotes('')
      setMessage(`Created profile ${normalized}`)
      await loadProfiles()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create memory profile')
    } finally {
      setCreating(false)
    }
  }

  function requestDelete(profile: MemoryProfileRecord) {
    const ok = window.confirm(
      `Delete profile "${profile.user_id}" and all memory entries for this profile? This cannot be undone.`,
    )
    if (!ok) return

    setDeletingId(profile.user_id)
    setMessage('')
    setError('')
    startTransition(async () => {
      try {
        const res = await fetch(`/api/memory/users/${encodeURIComponent(profile.user_id)}`, {
          method: 'DELETE',
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.error || data?.detail || `HTTP ${res.status}`)

        setMessage(`Deleted profile ${profile.user_id}`)
        await loadProfiles()
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to delete memory profile')
      } finally {
        setDeletingId(null)
      }
    })
  }

  return (
    <div className="max-w-6xl space-y-6 p-8">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Memory Profile Registry</h1>
          <p className="mt-1 text-sm text-gray-400">
            Manage profile buckets for memory. Create an empty profile first, then browse or add memory from the profile detail page.
          </p>
        </div>
        <button
          onClick={() => void loadProfiles()}
          className="rounded-lg border border-gray-700 px-3 py-2 text-xs font-medium text-gray-200 transition-colors hover:border-gray-500 hover:bg-gray-800"
        >
          Refresh
        </button>
      </div>

      {error && <div className="rounded-xl border border-red-800 bg-red-900/20 p-4 text-sm text-red-400">{error}</div>}
      {message && <div className="rounded-xl border border-green-800 bg-green-900/20 p-4 text-sm text-green-400">{message}</div>}

      <section className="rounded-2xl border border-gray-800 bg-gray-900/70 p-5">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-white">Create Profile</h2>
          <p className="mt-1 text-sm text-gray-400">
            Register a unique profile key before any memory entries exist. This is separate from the profile detail page used to browse and manage memory.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-[1.1fr_1fr_1fr_auto]">
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-gray-500">Profile Key</label>
            <input
              value={profileKey}
              onChange={(event) => setProfileKey(event.target.value)}
              placeholder="profile-123"
              className={inputCls}
            />
          </div>
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-gray-500">Label</label>
            <input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Optional label"
              className={inputCls}
            />
          </div>
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-gray-500">Notes</label>
            <input
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Optional notes"
              className={inputCls}
            />
          </div>
          <button
            onClick={() => void createProfile()}
            disabled={creating}
            className={btnCls}
          >
            {creating ? 'Creating…' : 'Create Profile'}
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-gray-800 bg-gray-900/70 p-5">
        <div className="mb-4 grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-gray-800 bg-gray-950/70 p-4">
            <p className="text-xs uppercase tracking-wider text-gray-500">Profiles</p>
            <p className="mt-2 text-2xl font-bold text-white">{loading ? '—' : totals.profiles}</p>
          </div>
          <div className="rounded-xl border border-gray-800 bg-gray-950/70 p-4">
            <p className="text-xs uppercase tracking-wider text-gray-500">Profiles With Entries</p>
            <p className="mt-2 text-2xl font-bold text-blue-400">{loading ? '—' : totals.withEntries}</p>
          </div>
          <div className="rounded-xl border border-gray-800 bg-gray-950/70 p-4">
            <p className="text-xs uppercase tracking-wider text-gray-500">Total Entries</p>
            <p className="mt-2 text-2xl font-bold text-purple-400">{loading ? '—' : totals.entries}</p>
          </div>
        </div>

        <div className="mb-4">
          <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-gray-500">Search</label>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search key, label, notes, created by"
            className={inputCls}
          />
        </div>

        {loading ? (
          <div className="space-y-2">
            {[...Array(4)].map((_, index) => (
              <div key={index} className="h-14 animate-pulse rounded-xl bg-gray-800/50" />
            ))}
          </div>
        ) : filteredProfiles.length === 0 ? (
          <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-6 text-sm text-gray-400">
            No memory profiles found.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-gray-800">
            <div className="grid grid-cols-[1.1fr_1fr_1fr_0.8fr_0.8fr_1.4fr] gap-4 border-b border-gray-800 bg-gray-950/80 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
              <span>Profile</span>
              <span>Label</span>
              <span>Notes</span>
              <span>Entries</span>
              <span>Created</span>
              <span>Actions</span>
            </div>
            <div className="divide-y divide-gray-800">
              {filteredProfiles.map((profile) => (
                <div key={profile.user_id} className="grid grid-cols-[1.1fr_1fr_1fr_0.8fr_0.8fr_1.4fr] gap-4 px-4 py-3 text-sm items-center">
                  <div>
                    <p className="break-all font-mono text-white">{profile.user_id}</p>
                    <p className="mt-1 text-xs text-gray-500">{profile.created_by ?? '—'}</p>
                  </div>
                  <span className="break-words text-gray-300">{profile.label || '—'}</span>
                  <span className="break-words text-gray-400">{profile.notes || '—'}</span>
                  <span className="font-semibold text-yellow-300">{profile.entry_count}</span>
                  <span className="text-gray-400">{fmtDate(profile.created_at)}</span>
                  <div className="flex flex-wrap gap-2">
                    <Link href={`/memory/${encodeURIComponent(profile.user_id)}`} className={btnGhost}>
                      Open
                    </Link>
                    <Link href={`/memory/${encodeURIComponent(profile.user_id)}?tab=add`} className="rounded-lg border border-blue-700/60 px-3 py-2 text-xs text-blue-200 hover:bg-blue-900/30">
                      Add Memory
                    </Link>
                    <button
                      onClick={() => requestDelete(profile)}
                      disabled={deletingId === profile.user_id || isPending}
                      className={btnDanger}
                    >
                      {deletingId === profile.user_id ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
