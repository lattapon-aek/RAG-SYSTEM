'use client'

import { useEffect, useState } from 'react'
import type { ApiKeyRecord } from '@/types'

function fmtDate(value: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

export default function ApiKeysUI() {
  const [keys, setKeys] = useState<ApiKeyRecord[]>([])
  const [clientId, setClientId] = useState('')
  const [label, setLabel] = useState('')
  const [createdKey, setCreatedKey] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function loadKeys() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/api-keys')
      const data = await res.json().catch(() => [])
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
      setKeys(Array.isArray(data) ? data : [])
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load API keys')
      setKeys([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadKeys()
  }, [])

  async function createKey() {
    setError('')
    setMessage('')
    setCreatedKey(null)
    if (!clientId.trim()) {
      setError('Client ID is required')
      return
    }
    setCreating(true)
    try {
      const res = await fetch('/api/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId.trim(),
          label: label.trim() || null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)

      setKeys((current) => [data.record as ApiKeyRecord, ...current])
      setCreatedKey(data.plaintext_key ?? null)
      setClientId('')
      setLabel('')
      setMessage(`Created API key for ${data.record.client_id}`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create API key')
    } finally {
      setCreating(false)
    }
  }

  async function revokeKey(id: string) {
    setError('')
    setMessage('')
    setRevokingId(id)
    try {
      const res = await fetch(`/api/api-keys/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
      setKeys((current) =>
        current.map((entry) =>
          entry.id === id ? { ...entry, revoked_at: data.revoked_at ?? new Date().toISOString() } : entry,
        ),
      )
      setMessage('Revoked API key')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to revoke API key')
    } finally {
      setRevokingId(null)
    }
  }

  return (
    <div className="max-w-6xl space-y-6 p-8">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Service Key Registry</h1>
          <p className="mt-1 text-sm text-gray-400">
            Create and revoke DB-backed service keys for client_id. This page is the source of truth for key
            material, while quota and rate limits live in the Client Report & Limits page.
          </p>
        </div>
        <button
          onClick={() => void loadKeys()}
          className="rounded-lg border border-gray-700 px-3 py-2 text-xs font-medium text-gray-200 transition-colors hover:border-gray-500 hover:bg-gray-800"
        >
          Refresh
        </button>
      </div>

      {error && <div className="rounded-xl border border-red-800 bg-red-900/20 p-4 text-sm text-red-400">{error}</div>}
      {message && <div className="rounded-xl border border-green-800 bg-green-900/20 p-4 text-sm text-green-400">{message}</div>}
      {createdKey && (
        <div className="rounded-xl border border-yellow-700 bg-yellow-900/20 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-yellow-300">Copy This Key Now</p>
          <p className="mt-2 font-mono text-sm text-white break-all">{createdKey}</p>
          <p className="mt-2 text-xs text-yellow-200/80">This plaintext key is shown only once.</p>
        </div>
      )}

      <section className="rounded-2xl border border-gray-800 bg-gray-900/70 p-5">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-white">Create API Key</h2>
          <p className="mt-1 text-sm text-gray-400">
            Bind the key to a <code>client_id</code>. The same client_id is used by Client Report & Limits for quota
            and rate-limit lookups. This page is for service client IDs, not dashboard user IDs.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-[1.2fr_1fr_auto]">
          <input
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
            placeholder="client_id"
            className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white outline-none transition-colors placeholder:text-gray-600 focus:border-purple-500"
          />
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Label (optional)"
            className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white outline-none transition-colors placeholder:text-gray-600 focus:border-purple-500"
          />
          <button
            disabled={creating}
            onClick={() => void createKey()}
            className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {creating ? 'Creating…' : 'Create Key'}
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-gray-800 bg-gray-900/70 p-5">
        {loading ? (
          <div className="space-y-2">
            {[...Array(4)].map((_, index) => (
              <div key={index} className="h-14 animate-pulse rounded-xl bg-gray-800/50" />
            ))}
          </div>
        ) : keys.length === 0 ? (
          <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-6 text-sm text-gray-400">
            No API keys created yet.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-gray-800">
            <div className="grid grid-cols-[1.1fr_0.9fr_0.8fr_0.8fr_0.8fr_0.6fr] gap-4 border-b border-gray-800 bg-gray-950/80 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
              <span>Client</span>
              <span>Label</span>
              <span>Key</span>
              <span>Created</span>
              <span>Last Used</span>
              <span>Status</span>
            </div>
            <div className="divide-y divide-gray-800">
              {keys.map((entry) => (
                <div key={entry.id} className="grid grid-cols-[1.1fr_0.9fr_0.8fr_0.8fr_0.8fr_0.6fr] gap-4 px-4 py-3 text-sm">
                  <div>
                    <p className="font-medium text-white">{entry.client_id}</p>
                    <p className="mt-1 font-mono text-xs text-gray-500">{entry.id.slice(0, 8)}…</p>
                  </div>
                  <span className="text-gray-300">{entry.label || '—'}</span>
                  <span className="font-mono text-cyan-300">{entry.key_prefix || 'hidden'}</span>
                  <span className="text-gray-400">{fmtDate(entry.created_at)}</span>
                  <span className="text-gray-400">{fmtDate(entry.last_used_at)}</span>
                  <div className="flex items-center justify-between gap-2">
                    <span className={`inline-flex rounded-full px-2 py-1 text-xs uppercase tracking-wider ${entry.revoked_at ? 'bg-red-900/30 text-red-300' : 'bg-green-900/30 text-green-300'}`}>
                      {entry.revoked_at ? 'revoked' : 'active'}
                    </span>
                    {!entry.revoked_at && (
                      <button
                        disabled={revokingId === entry.id}
                        onClick={() => void revokeKey(entry.id)}
                        className="rounded-lg bg-red-900/40 hover:bg-red-800/60 border border-red-800/40 px-2 py-1 text-xs text-red-300 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Revoke
                      </button>
                    )}
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
