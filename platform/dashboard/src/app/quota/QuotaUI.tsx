'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import type {
  AdminConfigAuditLogEntry,
  QuotaStats,
  RateLimitConfigStats,
  RateLimitStats,
} from '@/types'
import Tabs from '@/components/Tabs'

// ── Sparkline ───────────────────────────────────────────────────────────────
function Sparkline({ data }: { data: number[] }) {
  if (data.length < 2) {
    return <div className="w-16 h-5 flex items-center justify-center text-[10px] text-gray-600">—</div>
  }
  const w = 64, h = 20
  const max = Math.max(...data, 1)
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w
    const y = h - (v / max) * (h - 2) - 1
    return `${x},${y}`
  }).join(' ')
  const last = data[data.length - 1]
  const color = last > 0 ? '#f59e0b' : '#4b5563'
  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle
        cx={(((data.length - 1) / (data.length - 1)) * w)}
        cy={h - (last / max) * (h - 2) - 1}
        r="2.5"
        fill={color}
      />
    </svg>
  )
}

function StatBlock({
  label,
  value,
  accent,
  hint,
  valueClassName,
}: {
  label: string
  value: string
  accent: string
  hint?: string
  valueClassName?: string
}) {
  return (
    <div className="rounded-xl border border-gray-700/60 bg-gray-800/70 p-4">
      <p className="text-xs uppercase tracking-wider text-gray-500">{label}</p>
      <p className={`mt-2 text-2xl font-bold ${accent} ${valueClassName ?? ''}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  )
}

function sourceLabel(source?: 'runtime' | 'persistent' | 'env' | null, hasOverride?: boolean) {
  if (!hasOverride) return 'default policy'
  if (source === 'runtime') return 'runtime override'
  if (source === 'persistent') return 'persistent override'
  if (source === 'env') return 'env override'
  return 'override'
}

const QUOTA_TABS = [
  { id: 'create', label: 'Register Client' },
  { id: 'lookup', label: 'Lookup Client' },
  { id: 'manage', label: 'Manage Limits' },
  { id: 'live', label: 'Live Rate Limits' },
  { id: 'audit', label: 'Config Changes' },
]

export default function QuotaUI() {
  const [activeTab, setActiveTab] = useState('create')

  const [rateLimit, setRateLimit] = useState<RateLimitStats | null>(null)
  const [rateConfig, setRateConfig] = useState<RateLimitConfigStats | null>(null)
  const [auditLog, setAuditLog] = useState<AdminConfigAuditLogEntry[]>([])
  const [rateError, setRateError] = useState('')
  // sparkline history: Map<client_id, last-12 request counts>
  const rateHistory = useRef<Map<string, number[]>>(new Map())
  const [createClientId, setCreateClientId] = useState('')
  const [createLabel, setCreateLabel] = useState('')
  const [createdClientKey, setCreatedClientKey] = useState<string | null>(null)
  const [createError, setCreateError] = useState('')
  const [createMessage, setCreateMessage] = useState('')
  const [creatingClient, setCreatingClient] = useState(false)
  const [clientId, setClientId] = useState('')
  const [quota, setQuota] = useState<QuotaStats | null>(null)
  const [quotaError, setQuotaError] = useState('')
  const [lookupLoading, setLookupLoading] = useState(false)
  const [editLimit, setEditLimit] = useState('')
  const [editRpmLimit, setEditRpmLimit] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  const [deleteError, setDeleteError] = useState('')
  const [deleteMessage, setDeleteMessage] = useState('')
  const [deletingClient, setDeletingClient] = useState(false)
  const [isPending, startTransition] = useTransition()

  async function refreshRateLimitStats() {
    setRateError('')
    try {
      const res = await fetch('/api/rate-limit')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: RateLimitStats = await res.json()
      // accumulate sparkline history (max 12 points per client)
      const hist = rateHistory.current
      for (const client of (data.top_clients ?? [])) {
        const prev = hist.get(client.client_id) ?? []
        const next = [...prev, client.requests_this_minute ?? 0].slice(-12)
        hist.set(client.client_id, next)
      }
      setRateLimit(data)
    } catch (err: unknown) {
      setRateError(err instanceof Error ? err.message : 'Failed to load rate limits')
    }
  }

  async function refreshAuditLog() {
    try {
      const res = await fetch('/api/admin-action-log?limit=12')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setAuditLog(await res.json())
    } catch {
      setAuditLog([])
    }
  }

  useEffect(() => {
    void refreshRateLimitStats()
    void refreshAuditLog()
    const id = setInterval(() => void refreshRateLimitStats(), 20_000)
    return () => clearInterval(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function createClient() {
    const normalizedClientId = createClientId.trim()
    setCreateError('')
    setCreateMessage('')
    setCreatedClientKey(null)

    if (!normalizedClientId) {
      setCreateError('Client ID is required')
      return
    }

    setCreatingClient(true)
    try {
      const res = await fetch('/api/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: normalizedClientId,
          label: createLabel.trim() || null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
      setCreatedClientKey(data.plaintext_key ?? null)
      setCreateClientId('')
      setCreateLabel('')
      setCreateMessage(`Created client ${data.record?.client_id ?? normalizedClientId}`)
      await refreshAuditLog()
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create client')
    } finally {
      setCreatingClient(false)
    }
  }

  async function deleteClient(clientIdToDelete: string) {
    const normalizedClientId = clientIdToDelete.trim()
    if (!normalizedClientId) return

    setDeleteError('')
    setDeleteMessage('')
    setQuotaError('')
    setActionMessage('')
    setDeletingClient(true)

    try {
      const keysRes = await fetch('/api/api-keys')
      const keysData = await keysRes.json().catch(() => [])
      if (!keysRes.ok) throw new Error(keysData?.error || `HTTP ${keysRes.status}`)

      const matchingKeys = Array.isArray(keysData)
        ? keysData.filter((entry) => entry?.client_id === normalizedClientId && !entry?.revoked_at)
        : []

      for (const key of matchingKeys) {
        const revokeRes = await fetch(`/api/api-keys/${encodeURIComponent(key.id)}`, { method: 'DELETE' })
        const revokeData = await revokeRes.json().catch(() => ({}))
        if (!revokeRes.ok) throw new Error(revokeData?.error || `Failed to revoke ${key.id}`)
      }

      const [quotaRes, rateRes] = await Promise.all([
        fetch(`/api/quota/${encodeURIComponent(normalizedClientId)}`, { method: 'DELETE' }),
        fetch(`/api/rate-limit/${encodeURIComponent(normalizedClientId)}`, { method: 'DELETE' }),
      ])
      const quotaData = await quotaRes.json().catch(() => ({}))
      const rateData = await rateRes.json().catch(() => ({}))
      if (!quotaRes.ok) throw new Error(quotaData?.error || `Quota HTTP ${quotaRes.status}`)
      if (!rateRes.ok) throw new Error(rateData?.error || `Rate HTTP ${rateRes.status}`)

      if (quota?.client_id === normalizedClientId) {
        setQuota(null)
        setRateConfig(null)
        setEditLimit('')
        setEditRpmLimit('')
      }
      if (clientId === normalizedClientId) {
        setClientId('')
      }

      setDeleteMessage(`Deleted client ${normalizedClientId}`)
      await refreshAuditLog()
      await refreshRateLimitStats()
    } catch (err: unknown) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete client')
    } finally {
      setDeletingClient(false)
    }
  }

  const suggestedClients = useMemo(
    () => (Array.isArray(rateLimit?.top_clients) ? rateLimit.top_clients : []).map((entry) => entry.client_id),
    [rateLimit],
  )

  async function lookupConfig(targetClientId: string) {
    if (!targetClientId.trim()) return
    const normalizedClientId = targetClientId.trim()
    setLookupLoading(true)
    setQuotaError('')
    setActionMessage('')
    try {
      const [quotaRes, rateRes] = await Promise.all([
        fetch(`/api/quota/${encodeURIComponent(normalizedClientId)}`),
        fetch(`/api/rate-limit/${encodeURIComponent(normalizedClientId)}`),
      ])
      const quotaData = await quotaRes.json()
      const rateData = await rateRes.json()
      if (!quotaRes.ok) throw new Error(quotaData?.error || `Quota HTTP ${quotaRes.status}`)
      if (!rateRes.ok) throw new Error(rateData?.error || `Rate HTTP ${rateRes.status}`)
      setQuota(quotaData)
      setRateConfig(rateData)
      setEditLimit(String(quotaData.daily_limit ?? 0))
      setEditRpmLimit(String(rateData.rpm_limit ?? 0))
      setClientId(normalizedClientId)
      setDeleteError('')
      setDeleteMessage('')
    } catch (err: unknown) {
      setQuota(null)
      setRateConfig(null)
      setQuotaError(err instanceof Error ? err.message : 'Failed to load client limits')
    } finally {
      setLookupLoading(false)
    }
  }

  function submitQuotaUpdate() {
    if (!quota) return
    const parsed = Number.parseInt(editLimit, 10)
    if (Number.isNaN(parsed) || parsed < 0) {
      setQuotaError('Daily limit must be a non-negative integer')
      return
    }

    setQuotaError('')
    setActionMessage('')
    startTransition(async () => {
      try {
        const res = await fetch(`/api/quota/${encodeURIComponent(quota.client_id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ daily_limit: parsed }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data?.error || data?.detail || `HTTP ${res.status}`)
        setQuota(data)
        setEditLimit(String(data.daily_limit ?? parsed))
        setActionMessage('Quota override saved')
        await refreshAuditLog()
      } catch (err: unknown) {
        setQuotaError(err instanceof Error ? err.message : 'Failed to update quota')
      }
    })
  }

  function resetQuotaOverride() {
    if (!quota) return
    setQuotaError('')
    setActionMessage('')
    startTransition(async () => {
      try {
        const res = await fetch(`/api/quota/${encodeURIComponent(quota.client_id)}`, {
          method: 'DELETE',
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data?.error || data?.detail || `HTTP ${res.status}`)
        setQuota(data)
        setEditLimit(String(data.daily_limit ?? 0))
        setActionMessage('Quota override cleared')
        await refreshAuditLog()
      } catch (err: unknown) {
        setQuotaError(err instanceof Error ? err.message : 'Failed to reset quota override')
      }
    })
  }

  function submitRateLimitUpdate() {
    if (!rateConfig) return
    const parsed = Number.parseInt(editRpmLimit, 10)
    if (Number.isNaN(parsed) || parsed < 0) {
      setQuotaError('RPM limit must be a non-negative integer')
      return
    }

    setQuotaError('')
    setActionMessage('')
    startTransition(async () => {
      try {
        const res = await fetch(`/api/rate-limit/${encodeURIComponent(rateConfig.client_id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rpm_limit: parsed }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data?.error || data?.detail || `HTTP ${res.status}`)
        setRateConfig(data)
        setEditRpmLimit(String(data.rpm_limit ?? parsed))
        setActionMessage('Rate limit override saved')
        await refreshRateLimitStats()
        await refreshAuditLog()
      } catch (err: unknown) {
        setQuotaError(err instanceof Error ? err.message : 'Failed to update rate limit')
      }
    })
  }

  function resetRateLimitOverride() {
    if (!rateConfig) return
    setQuotaError('')
    setActionMessage('')
    startTransition(async () => {
      try {
        const res = await fetch(`/api/rate-limit/${encodeURIComponent(rateConfig.client_id)}`, {
          method: 'DELETE',
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data?.error || data?.detail || `HTTP ${res.status}`)
        setRateConfig(data)
        setEditRpmLimit(String(data.rpm_limit ?? 0))
        setActionMessage('Rate limit override cleared')
        await refreshRateLimitStats()
        await refreshAuditLog()
      } catch (err: unknown) {
        setQuotaError(err instanceof Error ? err.message : 'Failed to reset rate limit override')
      }
    })
  }

  return (
    <div className="flex flex-col h-screen bg-gray-950">

      {/* ── Header ── */}
      <div className="shrink-0 px-8 pt-6 pb-4 border-b border-gray-800">
        <h1 className="text-2xl font-bold text-white">Client Management</h1>
        <p className="mt-1 text-sm text-gray-400">
          Register new client IDs separately from lookup, quota, and RPM management. This page is keyed by client_id.
        </p>
      </div>

      {/* ── Tabs bar ── */}
      <div className="shrink-0 px-8">
        <Tabs tabs={QUOTA_TABS} active={activeTab} onChange={setActiveTab} />
      </div>

      {/* ── Tab content ── */}
      <div className="flex-1 overflow-y-auto px-8 py-6">

        {/* Register Client tab */}
        {activeTab === 'create' && (
          <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-5">
            <div className="mb-4">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400">Register Client</h2>
              <p className="mt-1 text-xs text-gray-500">
                Register a new client_id and issue its first DB-backed service key. Use Lookup Client after creation
                to manage quota and RPM separately.
              </p>
            </div>

            {createError && <p className="mb-3 text-sm text-red-400">{createError}</p>}
            {createMessage && <p className="mb-3 text-sm text-green-400">{createMessage}</p>}

            {createdClientKey && (
              <div className="mb-4 rounded-xl border border-yellow-700 bg-yellow-900/20 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-yellow-300">Copy This Key Now</p>
                <p className="mt-2 break-all font-mono text-sm text-white">{createdClientKey}</p>
                <p className="mt-2 text-xs text-yellow-200/80">
                  This plaintext key is shown only once. Store it securely.
                </p>
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-[1.2fr_1fr_auto]">
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Client ID
                </label>
                <input
                  value={createClientId}
                  onChange={(e) => setCreateClientId(e.target.value)}
                  placeholder="e.g. api-key-01"
                  className="w-full rounded-xl border border-gray-700 bg-gray-950 px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-gray-600 focus:border-purple-500"
                />
              </div>
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Label
                </label>
                <input
                  value={createLabel}
                  onChange={(e) => setCreateLabel(e.target.value)}
                  placeholder="Optional label"
                  className="w-full rounded-xl border border-gray-700 bg-gray-950 px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-gray-600 focus:border-purple-500"
                />
              </div>
              <button
                onClick={() => void createClient()}
                disabled={creatingClient}
                className="rounded-xl bg-cyan-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {creatingClient ? 'Registering…' : 'Register Client'}
              </button>
            </div>
          </div>
        )}

        {/* Client Lookup tab */}
        {activeTab === 'lookup' && (
          <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-5">
            <div className="mb-4">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400">Client Lookup</h2>
              <p className="mt-1 text-xs text-gray-500">
                Inspect one existing client_id. Use Manage Limits to edit quota and RPM, or Delete Client to remove it.
              </p>
            </div>

            <div className="flex flex-col gap-3 md:flex-row md:items-end">
              <div className="flex-1">
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Client ID
                </label>
                <input
                  list="quota-client-suggestions"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void lookupConfig(clientId)
                  }}
                  placeholder="e.g. alice, api-key-01"
                  className="w-full rounded-xl border border-gray-700 bg-gray-950 px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-gray-600 focus:border-purple-500"
                />
                <datalist id="quota-client-suggestions">
                  {suggestedClients.map((id) => (
                    <option key={id} value={id} />
                  ))}
                </datalist>
              </div>
              <button
                onClick={() => void lookupConfig(clientId)}
                disabled={lookupLoading || !clientId.trim()}
                className="rounded-xl bg-purple-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {lookupLoading ? 'Loading…' : 'Lookup Client'}
              </button>
            </div>

            {deleteError && <p className="mt-3 text-sm text-red-400">{deleteError}</p>}
            {deleteMessage && <p className="mt-3 text-sm text-green-400">{deleteMessage}</p>}

            {quota && rateConfig && (
              <div className="mt-5 space-y-5">
                <div className="grid gap-4 md:grid-cols-4">
                  <StatBlock
                    label="Client ID"
                    value={quota.client_id}
                    accent="text-white"
                    valueClassName="break-all whitespace-normal text-sm leading-snug font-mono"
                  />
                  <StatBlock label="Used Today" value={(quota.tokens_used_today ?? 0).toLocaleString()} accent="text-blue-400" />
                  <StatBlock
                    label="Quota Limit"
                    value={(quota.daily_limit ?? 0).toLocaleString()}
                    accent="text-yellow-400"
                    hint={sourceLabel(quota.override_source, quota.has_override)}
                  />
                  <StatBlock
                    label="RPM Limit"
                    value={(rateConfig.rpm_limit ?? 0).toLocaleString()}
                    accent="text-orange-400"
                    hint={sourceLabel(rateConfig.override_source, rateConfig.has_override)}
                  />
                </div>

                <div className="rounded-xl border border-gray-800 bg-gray-950/70 p-4">
                  <div className="mb-3">
                    <h3 className="text-sm font-semibold text-white">Client Actions</h3>
                    <p className="mt-1 text-xs text-gray-500">
                      Delete this client_id by revoking its API keys and clearing quota/rate-limit overrides.
                    </p>
                  </div>
                  <div className="flex flex-col gap-3 md:flex-row md:items-end">
                    <button
                      onClick={() => {
                        if (!quota) return
                        const ok = window.confirm(
                          `Delete client ${quota.client_id}? This revokes all API keys and clears quota/rate-limit overrides.`,
                        )
                        if (ok) void deleteClient(quota.client_id)
                      }}
                      disabled={deletingClient}
                      className="rounded-xl border border-red-700 bg-red-900/30 px-4 py-3 text-sm font-medium text-red-200 transition-colors hover:bg-red-800/50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {deletingClient ? 'Deleting…' : 'Delete Client'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Manage Limits tab */}
        {activeTab === 'manage' && (
          <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-5">
            <div className="mb-4">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400">Manage Limits</h2>
              <p className="mt-1 text-xs text-gray-500">
                Edit quota and RPM overrides for a selected client_id. Use Lookup Client first to load a client.
              </p>
            </div>

            {quotaError && <p className="mt-3 text-sm text-red-400">{quotaError}</p>}
            {actionMessage && <p className="mt-3 text-sm text-green-400">{actionMessage}</p>}

            {quota && rateConfig ? (
              <>
                <div className="grid gap-4 md:grid-cols-4">
                  <StatBlock
                    label="Client ID"
                    value={quota.client_id}
                    accent="text-white"
                    valueClassName="break-all whitespace-normal text-sm leading-snug font-mono"
                  />
                  <StatBlock label="Used Today" value={(quota.tokens_used_today ?? 0).toLocaleString()} accent="text-blue-400" />
                  <StatBlock
                    label="Remaining Today"
                    value={quota.remaining == null ? 'Unlimited' : quota.remaining.toLocaleString()}
                    accent={quota.remaining !== null && quota.remaining <= 0 ? 'text-red-400' : 'text-green-400'}
                  />
                  <StatBlock
                    label="Current Minute"
                    value={(rateConfig.requests_this_minute ?? 0).toLocaleString()}
                    accent="text-blue-400"
                  />
                </div>

                <div className="mt-5 grid gap-5 lg:grid-cols-2">
                  <div className="rounded-xl border border-gray-800 bg-gray-950/70 p-4">
                    <div className="mb-3">
                      <h3 className="text-sm font-semibold text-white">Token Quota Override</h3>
                      <p className="mt-1 text-xs text-gray-500">
                        Stored persistently when the Postgres migration is present. Set `0` for unlimited.
                      </p>
                    </div>
                    <div className="mb-4 grid gap-3 sm:grid-cols-2">
                      <StatBlock
                        label="Config Source"
                        value={sourceLabel(quota.override_source, quota.has_override)}
                        accent="text-gray-200"
                      />
                      <StatBlock
                        label="Quota Limit"
                        value={(quota.daily_limit ?? 0).toLocaleString()}
                        accent="text-yellow-400"
                      />
                    </div>
                    <div className="flex flex-col gap-3 md:flex-row md:items-end">
                      <div className="w-full md:max-w-xs">
                        <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-gray-500">
                          Daily Limit
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={editLimit}
                          onChange={(e) => setEditLimit(e.target.value)}
                          className="w-full rounded-xl border border-gray-700 bg-gray-900 px-4 py-3 text-sm text-white outline-none transition-colors focus:border-purple-500"
                        />
                      </div>
                      <button
                        onClick={submitQuotaUpdate}
                        disabled={isPending}
                        className="rounded-xl bg-purple-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isPending ? 'Saving…' : 'Save Quota'}
                      </button>
                      <button
                        onClick={resetQuotaOverride}
                        disabled={isPending}
                        className="rounded-xl border border-gray-700 px-4 py-3 text-sm font-medium text-gray-200 transition-colors hover:border-gray-500 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Reset
                      </button>
                    </div>
                  </div>

                  <div className="rounded-xl border border-gray-800 bg-gray-950/70 p-4">
                    <div className="mb-3">
                      <h3 className="text-sm font-semibold text-white">Rate Limit Override</h3>
                      <p className="mt-1 text-xs text-gray-500">
                        Adjust requests per minute for one client without restarting the service.
                      </p>
                    </div>
                    <div className="mb-4 grid gap-3 sm:grid-cols-2">
                      <StatBlock
                        label="Remaining"
                        value={
                          rateConfig.remaining_this_minute == null
                            ? 'Unlimited'
                            : rateConfig.remaining_this_minute.toLocaleString()
                        }
                        accent={
                          rateConfig.remaining_this_minute !== null && rateConfig.remaining_this_minute <= 0
                            ? 'text-red-400'
                            : 'text-green-400'
                        }
                      />
                      <StatBlock
                        label="Config Source"
                        value={sourceLabel(rateConfig.override_source, rateConfig.has_override)}
                        accent="text-gray-200"
                      />
                    </div>
                    <div className="flex flex-col gap-3 md:flex-row md:items-end">
                      <div className="w-full md:max-w-xs">
                        <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-gray-500">
                          RPM Limit
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={editRpmLimit}
                          onChange={(e) => setEditRpmLimit(e.target.value)}
                          className="w-full rounded-xl border border-gray-700 bg-gray-900 px-4 py-3 text-sm text-white outline-none transition-colors focus:border-purple-500"
                        />
                      </div>
                      <button
                        onClick={submitRateLimitUpdate}
                        disabled={isPending}
                        className="rounded-xl bg-orange-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isPending ? 'Saving…' : 'Save RPM'}
                      </button>
                      <button
                        onClick={resetRateLimitOverride}
                        disabled={isPending}
                        className="rounded-xl border border-gray-700 px-4 py-3 text-sm font-medium text-gray-200 transition-colors hover:border-gray-500 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Reset
                      </button>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-6 text-sm text-gray-400">
                Load a client in Lookup Client first to edit quota and RPM overrides.
              </div>
            )}
          </div>
        )}

        {/* Live Rate Limits tab */}
        {activeTab === 'live' && (
          <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400">Live Rate Limits</h2>
                <p className="mt-1 text-xs text-gray-500">
                  Current-minute counters from Redis, enriched with resolved RPM policy per client.
                </p>
              </div>
              <button
                onClick={() => void refreshRateLimitStats()}
                className="rounded-lg border border-gray-700 px-3 py-2 text-xs font-medium text-gray-200 transition-colors hover:border-gray-500 hover:bg-gray-800"
              >
                Refresh
              </button>
            </div>

            {rateError ? (
              <p className="text-sm text-red-400">{rateError}</p>
            ) : !rateLimit ? (
              <p className="text-sm text-gray-400">Loading rate-limit stats…</p>
            ) : (
              <>
                <div className="mb-4 grid gap-4 md:grid-cols-2">
                  <StatBlock
                    label="Active Clients"
                    value={(rateLimit.active_clients ?? 0).toString()}
                    accent="text-blue-400"
                    hint="clients with counters in current minute"
                  />
                  <StatBlock
                    label="Default RPM"
                    value={(rateLimit.default_rpm ?? 0).toString()}
                    accent="text-yellow-400"
                    hint="baseline request-per-minute limit"
                  />
                </div>

                <div className="overflow-hidden rounded-xl border border-gray-800">
                  <div className="grid grid-cols-[1.5fr_0.8fr_0.8fr_0.8fr_1fr] gap-4 border-b border-gray-800 bg-gray-950/80 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
                    <span>Client</span>
                    <span>Req / Min</span>
                    <span>Trend</span>
                    <span>RPM Limit</span>
                    <span>Source</span>
                  </div>
                  <div className="divide-y divide-gray-800">
                    {(Array.isArray(rateLimit.top_clients) ? rateLimit.top_clients : []).length === 0 ? (
                      <div className="px-4 py-5 text-sm text-gray-400">No active counters right now.</div>
                    ) : (
                      (Array.isArray(rateLimit.top_clients) ? rateLimit.top_clients : []).map((client) => (
                        <button
                          key={client.client_id}
                          onClick={() => void lookupConfig(client.client_id)}
                          className="grid w-full grid-cols-[1.5fr_0.8fr_0.8fr_0.8fr_1fr] gap-4 px-4 py-3 text-left transition-colors hover:bg-gray-800/70 items-center"
                        >
                          <span className="truncate font-mono text-white">{client.client_id}</span>
                          <span className="text-yellow-400">{client.requests_this_minute ?? 0}</span>
                          <span><Sparkline data={rateHistory.current.get(client.client_id) ?? [client.requests_this_minute ?? 0]} /></span>
                          <span className="text-orange-300">{client.rpm_limit ?? rateLimit.default_rpm ?? 0}</span>
                          <span className="text-gray-400">
                            {sourceLabel(client.override_source, client.has_override)}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Config Changes tab */}
        {activeTab === 'audit' && (
          <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400">Recent Config Changes</h2>
                <p className="mt-1 text-xs text-gray-500">Audit trail for quota and rate-limit overrides.</p>
              </div>
              <button
                onClick={() => void refreshAuditLog()}
                className="rounded-lg border border-gray-700 px-3 py-2 text-xs font-medium text-gray-200 transition-colors hover:border-gray-500 hover:bg-gray-800"
              >
                Refresh
              </button>
            </div>

            <div className="overflow-hidden rounded-xl border border-gray-800">
              <div className="grid grid-cols-[1.1fr_0.8fr_1fr_1fr_1.2fr] gap-4 border-b border-gray-800 bg-gray-950/80 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
                <span>When</span>
                <span>Admin</span>
                <span>Resource</span>
                <span>Target</span>
                <span>Change</span>
              </div>
              <div className="divide-y divide-gray-800">
                {(Array.isArray(auditLog) ? auditLog : []).length === 0 ? (
                  <div className="px-4 py-5 text-sm text-gray-400">No config changes recorded yet.</div>
                ) : (
                  (Array.isArray(auditLog) ? auditLog : []).map((entry) => (
                    <div
                      key={entry.id}
                      className="grid grid-cols-[1.1fr_0.8fr_1fr_1fr_1.2fr] gap-4 px-4 py-3 text-sm"
                    >
                      <span className="text-gray-300">
                        {entry.created_at ? new Date(entry.created_at).toLocaleString() : '-'}
                      </span>
                      <span className="truncate text-white">{entry.admin_user_id ?? '-'}</span>
                      <span className="uppercase tracking-wide text-purple-300">{entry.resource_type}</span>
                      <span className="truncate font-mono text-gray-200">{entry.target_id}</span>
                      <span className="text-gray-400">
                        {entry.action}
                        {entry.after_value?.['limit_value'] !== undefined
                          ? ` -> ${String(entry.after_value['limit_value'])}`
                          : ''}
                        {entry.after_value === null ? ' -> default' : ''}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
