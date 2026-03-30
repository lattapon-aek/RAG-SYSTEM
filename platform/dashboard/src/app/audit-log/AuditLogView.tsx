'use client'

import { useState, useMemo } from 'react'
import type { AuditLogEntry } from '@/types'
import FilterBar from '@/components/FilterBar'
import Pagination from '@/components/Pagination'

type ActionFilter = AuditLogEntry['action'] | 'all'

const ACTION_PILLS = [
  { label: 'All', value: 'all' },
  { label: 'Approved', value: 'approved' },
  { label: 'Rejected', value: 'rejected' },
  { label: 'Expired', value: 'expired' },
]

const ACTION_BADGE: Record<AuditLogEntry['action'], string> = {
  approved: 'bg-green-500/20 text-green-400 border-green-500/30',
  rejected: 'bg-red-500/20 text-red-400 border-red-500/30',
  expired: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
}

export default function AuditLogView({ entries }: { entries: AuditLogEntry[] }) {
  const [search, setSearch] = useState('')
  const [action, setAction] = useState<ActionFilter>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  const filtered = useMemo(() => {
    let list = entries
    if (action !== 'all') list = list.filter((e) => e.action === action)
    if (dateFrom) list = list.filter((e) => new Date(e.timestamp) >= new Date(dateFrom))
    if (dateTo) list = list.filter((e) => new Date(e.timestamp) <= new Date(dateTo + 'T23:59:59'))
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(
        (e) =>
          e.candidate_id.toLowerCase().includes(q) ||
          (e.admin_user_id ?? '').toLowerCase().includes(q) ||
          (e.notes ?? '').toLowerCase().includes(q)
      )
    }
    return list
  }, [entries, action, dateFrom, dateTo, search])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const paged = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  function reset() { setSearch(''); setAction('all'); setDateFrom(''); setDateTo(''); setPage(1) }
  function handleFilter(fn: () => void) { fn(); setPage(1) }

  return (
    <>
      <FilterBar
        search={search}
        onSearchChange={(v) => handleFilter(() => setSearch(v))}
        pills={[{
          label: 'Action',
          options: ACTION_PILLS,
          value: action,
          onChange: (v) => handleFilter(() => setAction(v as ActionFilter)),
        }]}
        resultCount={filtered.length}
        totalCount={entries.length}
        onReset={reset}
        extras={
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs text-gray-500 w-16 shrink-0">Date range</span>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => handleFilter(() => setDateFrom(e.target.value))}
                className="bg-gray-900 border border-gray-600 focus:border-blue-500 rounded-lg px-3 py-1 text-xs text-gray-200 outline-none transition-colors [color-scheme:dark]"
              />
              <span className="text-xs text-gray-500">→</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => handleFilter(() => setDateTo(e.target.value))}
                className="bg-gray-900 border border-gray-600 focus:border-blue-500 rounded-lg px-3 py-1 text-xs text-gray-200 outline-none transition-colors [color-scheme:dark]"
              />
            </div>
          </div>
        }
      />

      {paged.length === 0 ? (
        <div className="bg-gray-800 rounded-xl p-12 border border-gray-700 text-center">
          <p className="text-gray-400 text-sm">No audit log entries match your filters.</p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-gray-700 bg-gray-800">
            <table className="min-w-[880px] w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700 text-xs text-gray-400 uppercase tracking-wider">
                  <th className="px-5 py-3 text-left whitespace-nowrap">Time</th>
                  <th className="px-5 py-3 text-left whitespace-nowrap">Action</th>
                  <th className="px-5 py-3 text-left whitespace-nowrap">Candidate ID</th>
                  <th className="px-5 py-3 text-left whitespace-nowrap">By</th>
                  <th className="px-5 py-3 text-left whitespace-nowrap">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {paged.map((e) => (
                  <tr key={e.id} className="hover:bg-gray-700/30 transition-colors">
                    <td className="px-5 py-3 text-gray-400 whitespace-nowrap text-xs">
                      {new Date(e.timestamp).toLocaleString()}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${ACTION_BADGE[e.action]}`}>
                        {e.action === 'approved' && (
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                        )}
                        {e.action === 'rejected' && (
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
                        )}
                        {e.action === 'expired' && (
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        )}
                        {e.action}
                      </span>
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-gray-300 whitespace-nowrap">
                      {e.candidate_id.slice(0, 8)}…
                    </td>
                    <td className="px-5 py-3 text-gray-400 text-xs whitespace-nowrap">
                      {e.admin_user_id ?? <span className="text-gray-600">system</span>}
                    </td>
                    <td className="px-5 py-3 text-gray-500 text-xs italic break-words">
                      {e.notes ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination
            page={safePage}
            totalPages={totalPages}
            onPageChange={setPage}
            pageSize={pageSize}
            onPageSizeChange={(s) => { setPageSize(s); setPage(1) }}
            pageSizeOptions={[10, 25, 50, 100]}
            totalItems={filtered.length}
          />
        </>
      )}
    </>
  )
}
