'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { SystemOverview, ServiceHealthItem, SystemConfigSection } from '@/types'

function badgeForStatus(status: ServiceHealthItem['status']) {
  switch (status) {
    case 'healthy':
      return 'text-green-400 border-green-800/50 bg-green-900/20'
    case 'degraded':
      return 'text-amber-300 border-amber-800/50 bg-amber-900/20'
    case 'down':
      return 'text-red-400 border-red-800/50 bg-red-900/20'
    default:
      return 'text-gray-400 border-gray-700 bg-gray-800'
  }
}

function healthDot(status: ServiceHealthItem['status']) {
  switch (status) {
    case 'healthy':
      return 'bg-green-400'
    case 'degraded':
      return 'bg-amber-400'
    case 'down':
      return 'bg-red-400'
    default:
      return 'bg-gray-500'
  }
}

function fmtMs(value: number | null) {
  if (value === null) return '—'
  return `${value} ms`
}

function ConfigSection({ section }: { section: SystemConfigSection }) {
  return (
    <section className="rounded-2xl border border-gray-800 bg-gray-900/70 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-800">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{section.title}</h3>
      </div>
      <div className="divide-y divide-gray-800">
        {section.items.map((item) => (
          <div key={item.key} className="grid grid-cols-1 gap-3 px-4 py-3 md:grid-cols-[1.3fr_1.7fr] md:gap-4">
            <div>
              <div className="flex items-center gap-2">
                <code className="text-xs text-purple-300 break-all">{item.label}</code>
                <span className={`text-[10px] px-2 py-0.5 rounded-full border uppercase tracking-wide ${
                  item.source === 'env'
                    ? 'text-green-400 border-green-800/50 bg-green-900/20'
                    : 'text-gray-400 border-gray-700 bg-gray-800'
                }`}>
                  {item.source}
                </span>
              </div>
              <p className="text-[11px] text-gray-500 mt-1">{item.note}</p>
            </div>
            <div className="text-left md:text-right">
              <p className="text-sm text-white font-mono break-all">{item.value || '—'}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

export default function SystemOverviewPanel() {
  const [overview, setOverview] = useState<SystemOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [checkedAt, setCheckedAt] = useState<Date | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/system-overview', { cache: 'no-store' })
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }
      const data = (await res.json()) as SystemOverview
      setOverview(data)
      setCheckedAt(new Date(data.checked_at))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load system overview')
      setOverview(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const handler = () => load()
    window.addEventListener('dashboard:refresh', handler)
    return () => window.removeEventListener('dashboard:refresh', handler)
  }, [load])

  useEffect(() => {
    const id = setInterval(() => load(), 30_000)
    return () => clearInterval(id)
  }, [load])

  const healthyCount = overview?.summary.healthy ?? 0
  const degradedCount = overview?.summary.degraded ?? 0
  const downCount = overview?.summary.down ?? 0
  const modelLine = useMemo(() => {
    const providerSection = overview?.config_sections.find((section) => section.title === 'Providers')
    const modelSection = overview?.config_sections.find((section) => section.title === 'Models')
    if (!modelSection || !providerSection) return '—'
    const utilityProvider = providerSection.items.find((item) => item.key === 'UTILITY_LLM_PROVIDER')?.value
      ?? providerSection.items.find((item) => item.key === 'LLM_PROVIDER')?.value
    const utility = modelSection.items.find((item) => item.key === 'UTILITY_LLM_MODEL')?.value
      ?? modelSection.items.find((item) => item.key === 'LLM_MODEL')?.value
    const embedProvider = providerSection.items.find((item) => item.key === 'EMBEDDING_PROVIDER')?.value
    const embed = modelSection.items.find((item) => item.key === 'EMBEDDING_MODEL')?.value
    const left = utilityProvider && utility ? `${utilityProvider}:${utility}` : utility ?? utilityProvider ?? '—'
    const right = embedProvider && embed ? `${embedProvider}:${embed}` : embed ?? embedProvider ?? '—'
    return `${left} / ${right}`
  }, [overview])

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">System Overview</h2>
          <p className="text-sm text-gray-400 mt-1">
            Runtime config, model usage, and live health of core services.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span>{checkedAt ? `Checked ${checkedAt.toLocaleTimeString()}` : 'Not checked yet'}</span>
          <span className="px-2 py-1 rounded-full border border-gray-700 bg-gray-900/80 text-gray-400">
            Auto-refresh every 30s
          </span>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-800/50 bg-red-950/25 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {overview?.warnings?.length ? (
        <div className="rounded-2xl border border-amber-800/40 bg-amber-950/20 px-4 py-3 space-y-1">
          <p className="text-xs font-semibold text-amber-300 uppercase tracking-wider">Warnings</p>
          <ul className="space-y-1">
            {overview.warnings.map((warning) => (
              <li key={warning} className="text-sm text-amber-100/90">{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wider">Healthy Services</p>
          <p className="mt-2 text-2xl font-bold text-green-400">{loading ? '—' : healthyCount}</p>
        </div>
        <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wider">Degraded</p>
          <p className="mt-2 text-2xl font-bold text-amber-300">{loading ? '—' : degradedCount}</p>
        </div>
        <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wider">Down</p>
          <p className="mt-2 text-2xl font-bold text-red-400">{loading ? '—' : downCount}</p>
        </div>
        <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wider">Routing Pair</p>
          <p className="mt-2 text-sm font-mono text-white break-words">{loading ? '—' : modelLine}</p>
        </div>
      </div>

      <section className="rounded-2xl border border-gray-800 bg-gray-900/70 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Service Health</h3>
          <span className="text-xs text-gray-500">HTTP probes only</span>
        </div>
        <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
          {(overview?.service_health ?? []).map((service) => (
            <div key={service.name} className="rounded-xl border border-gray-800 bg-gray-950/50 p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-white">{service.name}</p>
                  <p className="text-[11px] text-gray-500 mt-0.5 break-all">{service.url}</p>
                </div>
                <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full border ${badgeForStatus(service.status)}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${healthDot(service.status)}`} />
                  {service.status}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-gray-400">
                <div>
                  <p className="text-gray-500">Latency</p>
                  <p className="text-gray-200">{fmtMs(service.latency_ms)}</p>
                </div>
                <div>
                  <p className="text-gray-500">Detail</p>
                  <p className="text-gray-200 truncate">{service.detail ?? '—'}</p>
                </div>
              </div>
            </div>
          ))}
          {loading && !overview && (
            <div className="col-span-full py-10 text-center text-gray-500">Loading service health…</div>
          )}
        </div>
      </section>

      <div className="space-y-4">
        {(overview?.config_sections ?? []).map((section) => (
          <ConfigSection key={section.title} section={section} />
        ))}
        {!loading && !overview && !error && (
          <div className="text-sm text-gray-500">No system overview data available.</div>
        )}
      </div>
    </div>
  )
}
