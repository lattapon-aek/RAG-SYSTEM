'use client'

import { useState, useEffect, useRef } from 'react'

interface NsSummary {
  namespace: string
  document_count: number
  chunk_count: number
  description?: string
  entity_count?: number
  relation_count?: number
  has_vector?: boolean
  has_graph?: boolean
}

function StoreBadge({ active, label, color }: { active: boolean; label: string; color: string }) {
  if (!active) return <span className="text-xs text-gray-700 font-mono">—</span>
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium ${color}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {label}
    </span>
  )
}

// ─── Inline editable description cell ────────────────────────────────────────

function DescCell({
  namespace,
  initial,
  onSaved,
}: {
  namespace: string
  initial?: string
  onSaved: (desc: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(initial ?? '')
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  async function save() {
    if (value === (initial ?? '')) { setEditing(false); return }
    setSaving(true)
    try {
      await fetch('/api/namespaces', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ namespace, description: value || null }),
      })
      onSaved(value)
    } finally {
      setSaving(false)
      setEditing(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') save()
    if (e.key === 'Escape') { setValue(initial ?? ''); setEditing(false) }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={onKeyDown}
        disabled={saving}
        placeholder="Add description…"
        className="w-full bg-gray-800 border border-purple-600 rounded px-2 py-1 text-xs text-white outline-none placeholder-gray-600"
      />
    )
  }

  return (
    <button
      onClick={() => setEditing(true)}
      title="Click to edit description"
      className="group flex items-center gap-1.5 text-left w-full"
    >
      {value ? (
        <span className="text-xs text-gray-400 group-hover:text-gray-200 transition-colors">{value}</span>
      ) : (
        <span className="text-xs text-gray-700 italic group-hover:text-gray-500 transition-colors">— add description</span>
      )}
      <svg className="w-3 h-3 text-gray-700 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
      </svg>
    </button>
  )
}

// ─── Main UI ─────────────────────────────────────────────────────────────────

export default function NamespacesUI() {
  const [namespaces, setNamespaces] = useState<NsSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/namespaces', { cache: 'no-store' })
      if (!res.ok) throw new Error('Failed to load')
      setNamespaces(await res.json())
    } catch {
      setError('Failed to load namespaces')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  function handleDescSaved(namespace: string, desc: string) {
    setNamespaces(prev =>
      prev.map(n => n.namespace === namespace ? { ...n, description: desc || undefined } : n)
    )
  }

  async function handleDelete(namespace: string) {
    setDeleting(namespace)
    setConfirmDelete(null)
    try {
      await fetch(`/api/namespaces/${encodeURIComponent(namespace)}`, { method: 'DELETE' })
      setNamespaces(prev => prev.filter(n => n.namespace !== namespace))
    } catch {
      setError(`Failed to delete namespace "${namespace}"`)
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 border-b border-gray-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-base font-semibold text-white">Namespaces</h1>
            <p className="text-xs text-gray-500 mt-0.5">
              Manage knowledge namespaces — edit descriptions to help agents discover the right namespace
            </p>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-300 text-xs rounded-lg transition-colors"
          >
            <svg className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {error && (
          <div className="mb-4 px-4 py-3 bg-red-900/20 border border-red-800/40 rounded-lg text-sm text-red-400">
            {error}
          </div>
        )}

        {loading && namespaces.length === 0 ? (
          <div className="flex items-center justify-center h-40 text-gray-600 text-sm">Loading…</div>
        ) : namespaces.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-center">
            <p className="text-gray-500 text-sm">No namespaces found</p>
            <p className="text-gray-700 text-xs mt-1">Ingest documents to create a namespace</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-gray-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 bg-gray-900/60">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Namespace</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-blue-400/70 uppercase tracking-wider w-36">Vector</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-emerald-400/70 uppercase tracking-wider w-36">Graph</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    Description
                    <span className="ml-1 text-gray-600 normal-case font-normal">(click to edit)</span>
                  </th>
                  <th className="px-4 py-3 w-16" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/60">
                {namespaces.map(ns => (
                  <tr key={ns.namespace} className="bg-gray-900/20 hover:bg-gray-800/30 transition-colors group">
                    <td className="px-4 py-3">
                      <span className="font-mono text-sm text-purple-300">{ns.namespace}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {ns.has_vector !== false ? (
                        <div className="flex flex-col items-center gap-0.5">
                          <StoreBadge active label="Vector" color="text-blue-400 border-blue-700/50 bg-blue-900/20" />
                          <span className="text-[10px] text-gray-600 tabular-nums">
                            {ns.document_count.toLocaleString()} docs · {ns.chunk_count.toLocaleString()} chunks
                          </span>
                        </div>
                      ) : (
                        <StoreBadge active={false} label="Vector" color="" />
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {ns.has_graph ? (
                        <div className="flex flex-col items-center gap-0.5">
                          <StoreBadge active label="Graph" color="text-emerald-400 border-emerald-700/50 bg-emerald-900/20" />
                          <span className="text-[10px] text-gray-600 tabular-nums">
                            {(ns.entity_count ?? 0).toLocaleString()} entities · {(ns.relation_count ?? 0).toLocaleString()} rels
                          </span>
                        </div>
                      ) : (
                        <StoreBadge active={false} label="Graph" color="" />
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <DescCell
                        namespace={ns.namespace}
                        initial={ns.description}
                        onSaved={desc => handleDescSaved(ns.namespace, desc)}
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      {confirmDelete === ns.namespace ? (
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => handleDelete(ns.namespace)}
                            disabled={deleting === ns.namespace}
                            className="px-2 py-1 bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white text-xs rounded transition-colors"
                          >
                            {deleting === ns.namespace ? '…' : 'Yes'}
                          </button>
                          <button
                            onClick={() => setConfirmDelete(null)}
                            className="px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded transition-colors"
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmDelete(ns.namespace)}
                          title="Delete namespace and all its documents"
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 text-gray-600 hover:text-red-400 rounded transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Info box */}
        {namespaces.length > 0 && (
          <div className="mt-4 px-4 py-3 bg-gray-800/40 border border-gray-700/40 rounded-lg">
            <p className="text-xs text-gray-500">
              <span className="text-gray-400 font-medium">Tip:</span> Descriptions help AI agents (via MCP) discover and select the right namespace automatically.
              The <code className="text-purple-400 font-mono">platform_list_namespaces</code> tool returns these descriptions.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
