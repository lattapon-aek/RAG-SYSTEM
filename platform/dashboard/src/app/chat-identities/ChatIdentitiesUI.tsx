'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import type { ChatIdentityRecord } from '@/types'

function fmtDate(value: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

type Draft = {
  name: string
  namespace: string
  client_id: string
  user_id: string
  description: string
}

const EMPTY_DRAFT: Draft = {
  name: '',
  namespace: 'default',
  client_id: '',
  user_id: '',
  description: '',
}

export default function ChatIdentitiesUI() {
  const [items, setItems] = useState<ChatIdentityRecord[]>([])
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [createDraft, setCreateDraft] = useState<Draft>(EMPTY_DRAFT)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [isPending, startTransition] = useTransition()

  const stats = useMemo(() => ({
    active: items.filter((item) => !item.revoked_at).length,
    revoked: items.filter((item) => !!item.revoked_at).length,
  }), [items])

  function hydrateDrafts(rows: ChatIdentityRecord[]) {
    const next: Record<string, Draft> = {}
    for (const row of rows) {
      next[row.id] = {
        name: row.name,
        namespace: row.namespace,
        client_id: row.client_id,
        user_id: row.user_id,
        description: row.description ?? '',
      }
    }
    setDrafts(next)
  }

  async function loadItems() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/chat-identities?include_revoked=1')
      const data = await res.json().catch(() => [])
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
      const rows = Array.isArray(data) ? data : []
      setItems(rows)
      hydrateDrafts(rows)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load chat identities')
      setItems([])
      setDrafts({})
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadItems()
  }, [])

  async function createIdentity() {
    setError('')
    setMessage('')
    if (!createDraft.name.trim()) {
      setError('Name is required')
      return
    }
    if (!createDraft.client_id.trim()) {
      setError('Client ID is required')
      return
    }
    if (!createDraft.user_id.trim()) {
      setError('User ID is required')
      return
    }
    setCreating(true)
    try {
      const res = await fetch('/api/chat-identities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createDraft),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
      const record = data as ChatIdentityRecord
      setItems((current) => [...current, record].sort((a, b) => a.name.localeCompare(b.name)))
      setDrafts((current) => ({
        ...current,
        [record.id]: {
          name: record.name,
          namespace: record.namespace,
          client_id: record.client_id,
          user_id: record.user_id,
          description: record.description ?? '',
        },
      }))
      setCreateDraft(EMPTY_DRAFT)
      setMessage(`Created chat identity ${record.name}`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create chat identity')
    } finally {
      setCreating(false)
    }
  }

  function updateDraft(id: string, patch: Partial<Draft>) {
    setDrafts((current) => ({
      ...current,
      [id]: {
        ...(current[id] ?? EMPTY_DRAFT),
        ...patch,
      },
    }))
  }

  function saveIdentity(id: string) {
    const draft = drafts[id]
    if (!draft) return
    setError('')
    setMessage('')
    setSavingId(id)
    startTransition(async () => {
      try {
        const res = await fetch(`/api/chat-identities/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(draft),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
        const record = data as ChatIdentityRecord
        setItems((current) =>
          current
            .map((item) => (item.id === id ? record : item))
            .sort((a, b) => a.name.localeCompare(b.name)),
        )
        setDrafts((current) => ({
          ...current,
          [id]: {
            name: record.name,
            namespace: record.namespace,
            client_id: record.client_id,
            user_id: record.user_id,
            description: record.description ?? '',
          },
        }))
        setMessage(`Updated ${record.name}`)
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to update chat identity')
      } finally {
        setSavingId(null)
      }
    })
  }

  async function revokeIdentity(id: string) {
    setError('')
    setMessage('')
    setRevokingId(id)
    try {
      const res = await fetch(`/api/chat-identities/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
      setItems((current) =>
        current.map((item) =>
          item.id === id ? { ...item, revoked_at: data.revoked_at ?? new Date().toISOString() } : item,
        ),
      )
      setMessage('Revoked chat identity')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to revoke chat identity')
    } finally {
      setRevokingId(null)
    }
  }

  return (
    <div className="max-w-7xl space-y-6 p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Chat Identities</h1>
          <p className="mt-1 max-w-3xl text-sm text-gray-400">
            Manage the reusable <code>client_id</code> and <code>user_id</code> pairs that power the Chat page and MCP handoff.
            Use this page when you want admin-controlled presets instead of typing IDs manually in Chat.
          </p>
        </div>
        <button
          onClick={() => void loadItems()}
          className="rounded-lg border border-gray-700 px-3 py-2 text-xs font-medium text-gray-200 transition-colors hover:border-gray-500 hover:bg-gray-800"
        >
          Refresh
        </button>
      </div>

      {error && <div className="rounded-xl border border-red-800 bg-red-900/20 p-4 text-sm text-red-400">{error}</div>}
      {message && <div className="rounded-xl border border-green-800 bg-green-900/20 p-4 text-sm text-green-400">{message}</div>}

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
          <p className="text-xs uppercase tracking-wider text-gray-500">Active profiles</p>
          <p className="mt-2 text-2xl font-bold text-cyan-300">{loading ? '—' : stats.active}</p>
        </div>
        <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
          <p className="text-xs uppercase tracking-wider text-gray-500">Revoked</p>
          <p className="mt-2 text-2xl font-bold text-red-400">{loading ? '—' : stats.revoked}</p>
        </div>
        <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
          <p className="text-xs uppercase tracking-wider text-gray-500">Total records</p>
          <p className="mt-2 text-2xl font-bold text-white">{loading ? '—' : items.length}</p>
        </div>
      </section>

      <section className="rounded-2xl border border-gray-800 bg-gray-900/70 p-5">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-white">Create Chat Identity</h2>
          <p className="mt-1 text-sm text-gray-400">
            Define one preset that combines a chat <code>user_id</code>, a service <code>client_id</code>, and the default namespace.
          </p>
        </div>
        <div className="grid gap-4 lg:grid-cols-[1fr_0.8fr_0.8fr_0.8fr_1.2fr_auto]">
          <input
            value={createDraft.name}
            onChange={(event) => setCreateDraft((current) => ({ ...current, name: event.target.value }))}
            placeholder="Name"
            className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white outline-none transition-colors placeholder:text-gray-600 focus:border-purple-500"
          />
          <input
            value={createDraft.namespace}
            onChange={(event) => setCreateDraft((current) => ({ ...current, namespace: event.target.value }))}
            placeholder="Namespace"
            className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white outline-none transition-colors placeholder:text-gray-600 focus:border-purple-500"
          />
          <input
            value={createDraft.client_id}
            onChange={(event) => setCreateDraft((current) => ({ ...current, client_id: event.target.value }))}
            placeholder="client_id"
            className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white outline-none transition-colors placeholder:text-gray-600 focus:border-purple-500"
          />
          <input
            value={createDraft.user_id}
            onChange={(event) => setCreateDraft((current) => ({ ...current, user_id: event.target.value }))}
            placeholder="user_id"
            className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white outline-none transition-colors placeholder:text-gray-600 focus:border-purple-500"
          />
          <input
            value={createDraft.description}
            onChange={(event) => setCreateDraft((current) => ({ ...current, description: event.target.value }))}
            placeholder="Description (optional)"
            className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white outline-none transition-colors placeholder:text-gray-600 focus:border-purple-500"
          />
          <button
            disabled={creating}
            onClick={() => void createIdentity()}
            className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {creating ? 'Creating…' : 'Create'}
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-gray-800 bg-gray-900/70 p-5">
        {loading ? (
          <div className="space-y-2">
            {[...Array(4)].map((_, index) => (
              <div key={index} className="h-16 animate-pulse rounded-xl bg-gray-800/50" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-6 text-sm text-gray-400">
            No chat identities found.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-gray-800">
            <div className="grid grid-cols-[1fr_0.8fr_1fr_1fr_1.2fr_0.8fr_0.9fr] gap-4 border-b border-gray-800 bg-gray-950/80 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
              <span>Name</span>
              <span>Namespace</span>
              <span>Client ID</span>
              <span>User ID</span>
              <span>Description</span>
              <span>Status</span>
              <span>Actions</span>
            </div>
            <div className="divide-y divide-gray-800">
              {items.map((item) => {
                const draft = drafts[item.id] ?? {
                  name: item.name,
                  namespace: item.namespace,
                  client_id: item.client_id,
                  user_id: item.user_id,
                  description: item.description ?? '',
                }
                return (
                  <div key={item.id} className="grid grid-cols-[1fr_0.8fr_1fr_1fr_1.2fr_0.8fr_0.9fr] gap-4 px-4 py-4 text-sm">
                    <input
                      value={draft.name}
                      onChange={(event) => updateDraft(item.id, { name: event.target.value })}
                      className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-purple-500"
                    />
                    <input
                      value={draft.namespace}
                      onChange={(event) => updateDraft(item.id, { namespace: event.target.value })}
                      className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-purple-500"
                    />
                    <input
                      value={draft.client_id}
                      onChange={(event) => updateDraft(item.id, { client_id: event.target.value })}
                      className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 font-mono text-sm text-white outline-none transition-colors focus:border-purple-500"
                    />
                    <input
                      value={draft.user_id}
                      onChange={(event) => updateDraft(item.id, { user_id: event.target.value })}
                      className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 font-mono text-sm text-white outline-none transition-colors focus:border-purple-500"
                    />
                    <input
                      value={draft.description}
                      onChange={(event) => updateDraft(item.id, { description: event.target.value })}
                      className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-purple-500"
                    />
                    <span className={`inline-flex h-fit rounded-full border px-2 py-1 text-xs uppercase tracking-wider ${
                      item.revoked_at
                        ? 'border-red-700/40 bg-red-900/20 text-red-300'
                        : 'border-green-700/40 bg-green-900/20 text-green-300'
                    }`}>
                      {item.revoked_at ? 'revoked' : 'active'}
                    </span>
                    <div className="flex items-start gap-2">
                      <button
                        disabled={savingId === item.id || isPending}
                        onClick={() => saveIdentity(item.id)}
                        className="rounded-lg bg-cyan-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Save
                      </button>
                      {!item.revoked_at && (
                        <button
                          disabled={revokingId === item.id}
                          onClick={() => void revokeIdentity(item.id)}
                          className="rounded-lg border border-red-800/50 bg-red-900/20 px-3 py-2 text-xs font-medium text-red-300 transition-colors hover:bg-red-900/40 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Revoke
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-gray-800 bg-gray-900/70 p-5 text-sm text-gray-300">
        <p className="font-semibold text-white">How this is used</p>
        <p className="mt-2 leading-6 text-gray-400">
          The Chat page can load these records as presets so an operator can pick a profile instead of typing IDs manually.
          The same <code>client_id</code> still drives quota and rate-limit tracking, while the <code>user_id</code> drives memory context.
        </p>
      </section>
    </div>
  )
}
