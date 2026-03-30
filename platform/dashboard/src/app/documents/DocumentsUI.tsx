'use client'

import { useState, useEffect, useCallback } from 'react'

interface Doc {
  id: string
  filename: string
  content_type: string
  namespace: string
  chunk_count: number
  ingested_at: string | null
}

interface DocVersion {
  id: string
  document_id: string
  version: number
  ingested_at: string | null
  chunk_count: number
  is_active: boolean
}

interface NamespaceSummary {
  namespace: string
  document_count: number
  chunk_count: number
}

function fmtDate(s: string | null) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function exportCsv(docs: Doc[]) {
  const header = 'id,filename,namespace,chunk_count,content_type,ingested_at'
  const rows = docs.map((d) =>
    [d.id, d.filename, d.namespace, d.chunk_count, d.content_type, d.ingested_at ?? '']
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(',')
  )
  const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = 'documents.csv'; a.click()
  URL.revokeObjectURL(url)
}

interface Chunk {
  id?: string
  chunk_index: number
  text: string
  token_count?: number
}

function ChunkPreviewDrawer({ doc, onClose }: { doc: Doc; onClose: () => void }) {
  const [chunks, setChunks] = useState<Chunk[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/documents/${doc.id}/chunks?namespace=${encodeURIComponent(doc.namespace)}`)
      .then((r) => r.json())
      .then((data) => setChunks(Array.isArray(data) ? data : (data.chunks ?? [])))
      .catch(() => setChunks([]))
      .finally(() => setLoading(false))
  }, [doc.id, doc.namespace])

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-[560px] h-full bg-gray-900 border-l border-gray-700 flex flex-col shadow-2xl">
        <div className="p-5 border-b border-gray-800 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-white truncate max-w-xs">{doc.filename}</h3>
            <p className="text-xs text-gray-500 mt-0.5">Chunk Preview · {doc.chunk_count} chunks</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="space-y-2">
              {[...Array(4)].map((_, i) => <div key={i} className="h-20 bg-gray-800/40 rounded-lg animate-pulse" />)}
            </div>
          ) : chunks.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-8">No chunks found</p>
          ) : (
            <div className="space-y-3">
              {chunks.map((chunk, idx) => (
                <div key={chunk.id ?? idx} className="rounded-lg border border-gray-700/50 bg-gray-800/40 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-mono text-blue-400/70">chunk #{chunk.chunk_index ?? idx}</span>
                    {chunk.token_count != null && (
                      <span className="text-[10px] text-gray-600">{chunk.token_count} tokens</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-300 leading-relaxed whitespace-pre-wrap">{chunk.text}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function VersionDrawer({ doc, onClose }: { doc: Doc; onClose: () => void }) {
  const [versions, setVersions] = useState<DocVersion[]>([])
  const [loading, setLoading] = useState(true)
  const [rolling, setRolling] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/documents/${doc.id}/versions?namespace=${encodeURIComponent(doc.namespace)}`)
      .then((r) => r.json())
      .then(setVersions)
      .catch(() => setVersions([]))
      .finally(() => setLoading(false))
  }, [doc.id, doc.namespace])

  async function rollback(versionId: string) {
    if (!confirm('Rollback to this version?')) return
    setRolling(versionId)
    try {
      await fetch(`/api/documents/${doc.id}/rollback/${versionId}?namespace=${encodeURIComponent(doc.namespace)}`, { method: 'POST' })
      const res = await fetch(`/api/documents/${doc.id}/versions?namespace=${encodeURIComponent(doc.namespace)}`)
      setVersions(await res.json())
    } finally {
      setRolling(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-[480px] h-full bg-gray-900 border-l border-gray-700 flex flex-col shadow-2xl">
        <div className="p-5 border-b border-gray-800 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-white truncate max-w-xs">{doc.filename}</h3>
            <p className="text-xs text-gray-500 mt-0.5">Version History</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => <div key={i} className="h-14 bg-gray-800/40 rounded-lg animate-pulse" />)}
            </div>
          ) : versions.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-8">No version history available</p>
          ) : (
            <div className="space-y-2">
              {versions.map((v) => (
                <div
                  key={v.id}
                  className={`rounded-lg border px-4 py-3 flex items-center justify-between ${
                    v.is_active ? 'border-purple-700/50 bg-purple-900/20' : 'border-gray-700/50 bg-gray-800/40'
                  }`}
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-white">v{v.version}</span>
                      {v.is_active && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-purple-600/30 text-purple-400 border border-purple-700/40">
                          Active
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">{fmtDate(v.ingested_at)} · {v.chunk_count} chunks</p>
                  </div>
                  {!v.is_active && (
                    <button
                      onClick={() => rollback(v.id)}
                      disabled={rolling === v.id}
                      className="text-xs px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors disabled:opacity-40"
                    >
                      {rolling === v.id ? 'Rolling back…' : 'Rollback'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function DocumentsUI() {
  const [docs, setDocs] = useState<Doc[]>([])
  const [namespaces, setNamespaces] = useState<NamespaceSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [namespace, setNamespace] = useState('default')
  const [deleting, setDeleting] = useState<string | null>(null)
  const [selectedDoc, setSelectedDoc] = useState<Doc | null>(null)
  const [previewDoc, setPreviewDoc] = useState<Doc | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setSelectedIds(new Set())
    try {
      const res = await fetch(`/api/documents?namespace=${namespace}`)
      setDocs(res.ok ? await res.json() : [])
    } catch {
      setDocs([])
    } finally {
      setLoading(false)
    }
  }, [namespace])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    fetch('/api/namespaces')
      .then((r) => r.json())
      .then((data) => { setNamespaces(Array.isArray(data) ? data : []) })
      .catch(() => setNamespaces([]))
  }, [])

  async function deleteDoc(id: string, filename: string, docNamespace: string) {
    if (!confirm(`Delete "${filename}" from namespace "${docNamespace}"? This cannot be undone.`)) return
    setDeleting(id)
    try {
      await fetch(`/api/documents/${id}?namespace=${encodeURIComponent(docNamespace)}`, { method: 'DELETE' })
      setDocs((prev) => prev.filter((d) => d.id !== id))
      setSelectedIds((prev) => { const next = new Set(prev); next.delete(id); return next })
    } finally {
      setDeleting(null)
    }
  }

  async function bulkDelete() {
    const ids = Array.from(selectedIds)
    if (!confirm(`Delete ${ids.length} selected document(s)? This cannot be undone.`)) return
    setBulkDeleting(true)
    try {
      await Promise.all(
        ids.map((id) => {
          const doc = docs.find((d) => d.id === id)
          if (!doc) return Promise.resolve()
          return fetch(`/api/documents/${id}?namespace=${encodeURIComponent(doc.namespace)}`, { method: 'DELETE' })
        })
      )
      setDocs((prev) => prev.filter((d) => !selectedIds.has(d.id)))
      setSelectedIds(new Set())
    } finally {
      setBulkDeleting(false)
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const filtered = search.trim()
    ? docs.filter((d) => d.filename.toLowerCase().includes(search.toLowerCase()))
    : docs

  const allSelected = filtered.length > 0 && filtered.every((d) => selectedIds.has(d.id))
  function toggleAll() {
    if (allSelected) setSelectedIds(new Set())
    else setSelectedIds(new Set(filtered.map((d) => d.id)))
  }

  const totalChunks = docs.reduce((s, d) => s + d.chunk_count, 0)

  return (
    <div className="p-6 max-w-5xl space-y-6">
      {selectedDoc && (
        <VersionDrawer doc={selectedDoc} onClose={() => setSelectedDoc(null)} />
      )}
      {previewDoc && (
        <ChunkPreviewDrawer doc={previewDoc} onClose={() => setPreviewDoc(null)} />
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Documents</h1>
          <p className="text-sm text-gray-400 mt-1">Ingested documents with version history and chunk metadata</p>
        </div>
        <div className="flex gap-2">
          {docs.length > 0 && (
            <button
              onClick={() => exportCsv(filtered)}
              className="text-xs text-gray-400 hover:text-white px-3 py-1.5 rounded-lg border border-gray-700 hover:border-gray-500 transition-colors"
            >
              Export CSV
            </button>
          )}
          <button
            onClick={load}
            className="text-xs text-gray-400 hover:text-white px-3 py-1.5 rounded-lg border border-gray-700 hover:border-gray-500 transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-4">
          <p className="text-xs text-gray-400 mb-1">Documents</p>
          <p className="text-2xl font-bold text-white">{loading ? '—' : docs.length}</p>
        </div>
        <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-4">
          <p className="text-xs text-gray-400 mb-1">Total Chunks</p>
          <p className="text-2xl font-bold text-blue-400">{loading ? '—' : totalChunks.toLocaleString()}</p>
        </div>
        <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-4">
          <p className="text-xs text-gray-400 mb-1">Namespace</p>
          <p className="text-lg font-bold text-purple-300 font-mono truncate">{namespace}</p>
        </div>
      </div>

      <div className="bg-gray-800/40 border border-gray-700/50 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-gray-400">Namespace</p>
          {namespaces.length > 0 && <p className="text-xs text-gray-600">{namespaces.length} available</p>}
        </div>
        {namespaces.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {namespaces.map((ns) => {
              const active = ns.namespace === namespace
              return (
                <button
                  key={ns.namespace}
                  onClick={() => { setNamespace(ns.namespace); setSearch('') }}
                  className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                    active
                      ? 'border-purple-600 bg-purple-600/20 text-purple-300'
                      : 'border-gray-700 bg-gray-900/60 text-gray-300 hover:border-gray-500 hover:text-white'
                  }`}
                >
                  {ns.namespace}
                  <span className="ml-1.5 text-gray-500">{ns.document_count} docs</span>
                </button>
              )
            })}
          </div>
        )}
        <div className="flex gap-2">
          <input
            list="namespace-options"
            value={namespace}
            onChange={(e) => setNamespace(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && load()}
            placeholder="or type a namespace…"
            className="flex-1 bg-gray-900 border border-gray-700 focus:border-purple-600 rounded-lg px-3 py-1.5 text-xs text-white placeholder-gray-600 outline-none font-mono transition-colors"
          />
          <button
            onClick={load}
            className="text-xs px-3 py-1.5 rounded-lg border border-gray-700 text-gray-400 hover:border-gray-500 hover:text-white transition-colors"
          >
            Load
          </button>
          <datalist id="namespace-options">
            {namespaces.map((ns) => <option key={ns.namespace} value={ns.namespace} />)}
          </datalist>
        </div>
      </div>

      <div className="relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setSelectedIds(new Set()) }}
          placeholder="Search by filename…"
          className="w-full bg-gray-800 border border-gray-700 focus:border-purple-600 rounded-lg pl-9 pr-3 py-2 text-sm text-white outline-none placeholder-gray-500"
        />
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-gray-700 bg-gray-800/80 px-3 py-2 text-xs">
          <span className="text-gray-400 mr-1">{selectedIds.size} selected</span>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="px-2.5 py-1 rounded-md text-gray-500 hover:text-gray-300 transition-colors"
          >
            Clear
          </button>
          <div className="ml-auto">
            <button
              onClick={bulkDelete}
              disabled={bulkDeleting}
              className="px-3 py-1.5 rounded-lg bg-red-900/60 hover:bg-red-800/80 text-red-300 border border-red-800/40 transition-colors disabled:opacity-40"
            >
              {bulkDeleting ? 'Deleting…' : 'Delete selected'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => <div key={i} className="h-12 bg-gray-800/40 rounded-xl animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-600">
          <svg className="w-10 h-10 mx-auto mb-3 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="text-sm">{search ? 'No documents match' : 'No documents ingested yet'}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-700/50">
                <th className="pb-2 pr-3 w-8">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="rounded border-gray-600 bg-gray-800 text-purple-600 focus:ring-purple-500 focus:ring-offset-0"
                  />
                </th>
                <th className="pb-2 pr-4 font-medium">Filename</th>
                <th className="pb-2 pr-4 font-medium">Namespace</th>
                <th className="pb-2 pr-4 font-medium">Chunks</th>
                <th className="pb-2 pr-4 font-medium">Type</th>
                <th className="pb-2 pr-4 font-medium">Ingested</th>
                <th className="pb-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/30">
              {filtered.map((doc) => (
                <tr key={doc.id} className={`hover:bg-gray-800/40 transition-colors ${selectedIds.has(doc.id) ? 'bg-purple-900/10' : ''}`}>
                  <td className="py-2.5 pr-3">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(doc.id)}
                      onChange={() => toggleSelect(doc.id)}
                      className="rounded border-gray-600 bg-gray-800 text-purple-600 focus:ring-purple-500 focus:ring-offset-0"
                    />
                  </td>
                  <td className="py-2.5 pr-4 text-white font-medium truncate max-w-[220px]">{doc.filename}</td>
                  <td className="py-2.5 pr-4">
                    <span className="rounded-full border border-purple-700/40 bg-purple-900/20 px-2 py-1 text-[11px] font-mono text-purple-300">
                      {doc.namespace}
                    </span>
                  </td>
                  <td className="py-2.5 pr-4 text-blue-400 font-mono text-xs">{doc.chunk_count}</td>
                  <td className="py-2.5 pr-4 text-gray-500 text-xs truncate max-w-[120px]">{doc.content_type || '—'}</td>
                  <td className="py-2.5 pr-4 text-gray-400 text-xs whitespace-nowrap">{fmtDate(doc.ingested_at)}</td>
                  <td className="py-2.5">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setPreviewDoc(doc)}
                        className="text-xs px-2.5 py-1 rounded-lg bg-blue-900/30 hover:bg-blue-900/60 text-blue-400 border border-blue-800/40 transition-colors"
                      >
                        Preview
                      </button>
                      <button
                        onClick={() => setSelectedDoc(doc)}
                        className="text-xs px-2.5 py-1 rounded-lg bg-gray-700/60 hover:bg-gray-700 text-gray-300 transition-colors"
                      >
                        Versions
                      </button>
                      <button
                        onClick={() => deleteDoc(doc.id, doc.filename, doc.namespace)}
                        disabled={deleting === doc.id}
                        className="text-xs px-2.5 py-1 rounded-lg bg-red-900/30 hover:bg-red-900/60 text-red-400 border border-red-800/40 transition-colors disabled:opacity-40"
                      >
                        {deleting === doc.id ? '…' : 'Delete'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
