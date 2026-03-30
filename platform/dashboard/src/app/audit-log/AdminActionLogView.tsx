'use client'

import { useMemo, useState } from 'react'
import type { AdminConfigAuditLogEntry } from '@/types'

export default function AdminActionLogView({ entries }: { entries: AdminConfigAuditLogEntry[] }) {
  const [search, setSearch] = useState('')
  const [resourceType, setResourceType] = useState('all')

  const resourceTypes = useMemo(
    () => Array.from(new Set(entries.map((entry) => entry.resource_type))).sort(),
    [entries],
  )

  const filtered = useMemo(() => {
    return entries.filter((entry) => {
      if (resourceType !== 'all' && entry.resource_type !== resourceType) {
        return false
      }

      if (!search.trim()) {
        return true
      }

      const query = search.toLowerCase()
      return (
        (entry.admin_user_id ?? '').toLowerCase().includes(query) ||
        entry.action.toLowerCase().includes(query) ||
        entry.resource_type.toLowerCase().includes(query) ||
        entry.target_id.toLowerCase().includes(query) ||
        (entry.notes ?? '').toLowerCase().includes(query)
      )
    })
  }, [entries, resourceType, search])

  return (
    <section className="mt-8">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Admin Actions</h2>
          <p className="mt-1 text-sm text-gray-400">
            Quota, rate-limit, document, cache, and knowledge-gap actions recorded by the dashboard.
          </p>
        </div>
        <div className="flex gap-3">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search action log…"
            className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white outline-none transition-colors placeholder:text-gray-600 focus:border-purple-500"
          />
          <select
            value={resourceType}
            onChange={(event) => setResourceType(event.target.value)}
            className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-purple-500"
          >
            <option value="all">All resources</option>
            {resourceTypes.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-700 bg-gray-800">
        <div className="min-w-[860px]">
          <div className="grid grid-cols-[1.1fr_0.8fr_1fr_1fr_1.2fr] gap-4 border-b border-gray-700 px-5 py-3 text-xs uppercase tracking-wider text-gray-400">
            <span>Time</span>
            <span>Admin</span>
            <span>Resource</span>
            <span>Target</span>
            <span>Action</span>
          </div>
          <div className="divide-y divide-gray-700">
            {filtered.length === 0 ? (
              <div className="px-5 py-6 text-sm text-gray-400">No admin actions match the current filters.</div>
            ) : (
              filtered.map((entry) => (
                <div key={entry.id} className="grid grid-cols-[1.1fr_0.8fr_1fr_1fr_1.2fr] gap-4 px-5 py-3 text-sm">
                  <span className="text-gray-300">{entry.created_at ? new Date(entry.created_at).toLocaleString() : '—'}</span>
                  <span className="truncate text-white">{entry.admin_user_id ?? 'system'}</span>
                  <span className="uppercase tracking-wide text-purple-300">{entry.resource_type}</span>
                  <span className="truncate font-mono text-gray-200">{entry.target_id}</span>
                  <span className="text-gray-400">
                    {entry.action}
                    {entry.after_value?.['limit_value'] !== undefined
                      ? ` -> ${String(entry.after_value['limit_value'])}`
                      : ''}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
