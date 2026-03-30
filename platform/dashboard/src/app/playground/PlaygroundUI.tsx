'use client'

import { useState, useRef, useCallback, useEffect } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SearchResult {
  title: string
  url: string
  snippet: string
  source: string
  published_at?: string
}

interface ScrapeResult {
  url: string
  title: string
  text: string
  status_code: number
}

interface PageMetadataResult {
  url: string
  title: string
  description: string
  author: string
  published_at?: string | null
  canonical_url: string
  site_name: string
  language: string
  keywords: string[]
  status_code: number
  content_type: string
  text_length: number
  text_preview: string
  metadata?: Record<string, unknown>
}

interface BatchScrapeItem {
  url: string
  status: string
  title?: string
  description?: string
  author?: string
  published_at?: string | null
  canonical_url?: string
  site_name?: string
  language?: string
  keywords?: string[]
  status_code?: number | null
  content_type?: string
  text_length?: number
  text_preview?: string
  reason?: string | null
  error?: string | null
  metadata?: Record<string, unknown>
  ingestion?: Record<string, unknown> | null
  approval_candidate_id?: string | null
  approval_error?: string | null
  approval_queued?: boolean
}

interface BatchScrapeResult {
  total: number
  succeeded: number
  failed: number
  namespace: string
  auto_ingest: boolean
  approval_submitted?: number
  items: BatchScrapeItem[]
}

interface JobStatus {
  job_id: string
  status: string
  progress: number
  error?: string
}

type Tab = 'ingest' | 'harvest'
type IngestMode = 'text' | 'file'

interface PlaygroundNamespaceProps {
  namespace: string
  setNamespace: (value: string) => void
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    queued: 'bg-yellow-900/40 text-yellow-400 border-yellow-700/50',
    processing: 'bg-blue-900/40 text-blue-400 border-blue-700/50',
    processing_graph: 'bg-amber-900/40 text-amber-300 border-amber-700/50',
    done: 'bg-green-900/40 text-green-400 border-green-700/50',
    failed: 'bg-red-900/40 text-red-400 border-red-700/50',
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded border font-mono ${colors[status] ?? 'bg-gray-800 text-gray-400 border-gray-700'}`}>
      {status}
    </span>
  )
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="w-full bg-gray-800 rounded-full h-1.5 mt-2">
      <div
        className="bg-purple-500 h-1.5 rounded-full transition-all duration-300"
        style={{ width: `${Math.min(100, value)}%` }}
      />
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">{children}</p>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-gray-400 block mb-1">{label}</label>
      {children}
    </div>
  )
}

// ─── Shared input styles ──────────────────────────────────────────────────────

const inputCls = 'w-full bg-gray-800 border border-gray-700 focus:border-purple-600 rounded-lg px-3 py-2 text-sm text-white outline-none transition-colors placeholder-gray-500'
const btnPrimary = 'px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm rounded-lg transition-colors font-medium'
const btnSecondary = 'px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm rounded-lg transition-colors'

// ─── Shared: Namespace Input with autocomplete + description ─────────────────

interface NsMeta { namespace: string; description?: string }

function useNamespaces() {
  const [list, setList] = useState<NsMeta[]>([])
  useEffect(() => {
    fetch('/api/namespaces').then(r => r.ok ? r.json() : []).then(setList).catch(() => {})
  }, [])
  return list
}

function NamespaceInput({
  value, onChange, saveDescription,
}: {
  value: string
  onChange: (v: string) => void
  saveDescription?: (ns: string, desc: string) => Promise<void>
}) {
  const namespaces = useNamespaces()
  const [showList, setShowList] = useState(false)
  const [newDesc, setNewDesc] = useState('')
  const existing = namespaces.find(n => n.namespace === value)
  const isNew = value.trim() !== '' && !existing

  async function handleSaveDesc() {
    if (!saveDescription || !value.trim()) return
    await saveDescription(value.trim(), newDesc)
    setNewDesc('')
  }

  return (
    <div className="space-y-1.5">
      <div className="relative">
        <input
          value={value}
          onChange={e => { onChange(e.target.value); setShowList(true) }}
          onFocus={() => setShowList(true)}
          onBlur={() => setTimeout(() => setShowList(false), 150)}
          className={inputCls}
          placeholder="default"
          autoComplete="off"
        />
        {showList && namespaces.length > 0 && (
          <div className="absolute z-10 top-full mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg shadow-lg overflow-hidden">
            {namespaces
              .filter(n => n.namespace.includes(value) || value === '')
              .map(n => (
                <button
                  key={n.namespace}
                  onMouseDown={() => { onChange(n.namespace); setShowList(false) }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-700 transition-colors"
                >
                  <span className="text-sm text-white font-mono">{n.namespace}</span>
                  {n.description && <span className="text-xs text-gray-500 ml-2">— {n.description}</span>}
                </button>
              ))}
          </div>
        )}
      </div>
      {existing?.description && (
        <p className="text-xs text-gray-500">{existing.description}</p>
      )}
      {isNew && saveDescription && (
        <div className="flex gap-2">
          <input
            value={newDesc}
            onChange={e => setNewDesc(e.target.value)}
            placeholder="Add description for new namespace (optional)"
            className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-300 outline-none focus:border-purple-600"
          />
          <button
            onClick={handleSaveDesc}
            className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 text-xs rounded-lg transition-colors"
          >
            Save
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Tab: Ingest ─────────────────────────────────────────────────────────────

function IngestTab({ namespace, setNamespace }: PlaygroundNamespaceProps) {
  const [mode, setMode] = useState<IngestMode>('text')
  const [text, setText] = useState('')
  const [filename, setFilename] = useState('document.txt')
  const [sourceUrl, setSourceUrl] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [approvalCandidateId, setApprovalCandidateId] = useState('')
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  async function submit() {
    setError('')
    setMessage('')
    setApprovalCandidateId('')
    setLoading(true)
    try {
      if (mode === 'text') {
        if (!text.trim()) { setError('Text is required'); setLoading(false); return }
        const submitRes = await fetch('/api/ingest-preview/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source: 'text',
            text,
            filename,
            namespace,
            source_url: sourceUrl || undefined,
            mime_type: 'text/plain',
          }),
        })
        const submitData = await submitRes.json()
        if (!submitRes.ok) {
          setError(submitData.detail ?? submitData.error ?? 'Approval submission failed')
          return
        }
        setApprovalCandidateId(submitData?.candidate?.id ?? '')
        setMessage('Submitted to the approval queue.')
      } else {
        if (!file) { setError('Select a file first'); setLoading(false); return }
        const form = new FormData()
        form.append('source', 'file')
        form.append('namespace', namespace)
        form.append('filename', filename || file.name)
        if (sourceUrl.trim()) form.append('url', sourceUrl.trim())
        form.append('mime_type', file.type || 'application/octet-stream')
        form.append('file', file, file.name)
        const submitRes = await fetch('/api/ingest-preview/submit', { method: 'POST', body: form })
        const submitData = await submitRes.json()
        if (!submitRes.ok) {
          setError(submitData.detail ?? submitData.error ?? 'Approval submission failed')
          return
        }
        setApprovalCandidateId(submitData?.candidate?.id ?? '')
        setMessage('Uploaded file submitted to the approval queue.')
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Mode toggle */}
      <div className="flex gap-2">
        {(['text', 'file'] as IngestMode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${mode === m ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
          >
            {m === 'text' ? 'Paste Text' : 'Upload File'}
          </button>
        ))}
      </div>

      {mode === 'text' ? (
        <>
          <Field label="Filename (used as document title)">
            <input value={filename} onChange={(e) => setFilename(e.target.value)} className={inputCls} placeholder="document.txt" />
          </Field>
          <Field label="Source URL (optional)">
            <input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} className={inputCls} placeholder="https://..." />
          </Field>
          <Field label="Content">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={10}
              className={`${inputCls} resize-y font-mono text-xs`}
              placeholder="Paste your document content here…"
            />
            <p className="text-xs text-gray-500 mt-1">{text.length.toLocaleString()} chars</p>
          </Field>
        </>
      ) : (
        <Field label="File">
          <div
            onClick={() => fileRef.current?.click()}
            className="border-2 border-dashed border-gray-700 hover:border-purple-600 rounded-lg p-8 text-center cursor-pointer transition-colors"
          >
            {file ? (
              <div>
                <p className="text-sm text-white font-medium">{file.name}</p>
                <p className="text-xs text-gray-400 mt-1">{(file.size / 1024).toFixed(1)} KB</p>
              </div>
            ) : (
              <>
                <svg className="w-8 h-8 text-gray-600 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <p className="text-sm text-gray-400">Click to select file</p>
                <p className="text-xs text-gray-600 mt-1">PDF, TXT, DOCX, MD supported</p>
              </>
            )}
          </div>
          <input ref={fileRef} type="file" className="hidden" accept=".pdf,.txt,.md,.docx,.csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </Field>
      )}

      <button onClick={submit} disabled={loading} className={btnPrimary}>
        {loading ? 'Submitting…' : 'Submit for approval'}
      </button>

      <p className="text-xs text-gray-500">
        This flow sends content straight to the approval queue. Review and preview happen on the Approvals page.
      </p>

      {error && <p className="text-sm text-red-400 bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2">{error}</p>}

      {(message || approvalCandidateId) && (
        <div className="bg-gray-800/60 border border-gray-700/50 rounded-lg p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono text-gray-400">Approval queue</span>
            <StatusBadge status="queued" />
          </div>
          <p className="text-xs text-green-400 mt-1">{message}</p>
          {approvalCandidateId && (
            <p className="text-xs text-gray-400">
              Open candidate: <a className="text-sky-300 hover:underline" href={`/approvals/${approvalCandidateId}`}>{approvalCandidateId}</a>
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Tab: Knowledge Harvest ─────────────────────────────────────────────────

function KnowledgeHarvestTab({ namespace, setNamespace }: PlaygroundNamespaceProps) {
  const [batchUrls, setBatchUrls] = useState('')
  const [batchConcurrency, setBatchConcurrency] = useState(3)
  const [batchLoading, setBatchLoading] = useState(false)
  const [batchResult, setBatchResult] = useState<BatchScrapeResult | null>(null)
  const [batchError, setBatchError] = useState('')

  function parseUrls(text: string) {
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
  }

  async function runBatchScrape() {
    const urls = parseUrls(batchUrls)
    if (urls.length === 0) return
    setBatchError('')
    setBatchResult(null)
    setBatchLoading(true)
    try {
      const res = await fetch('/api/playground/batch-scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          urls,
          namespace,
          max_concurrency: batchConcurrency,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setBatchError(data.detail ?? data.error ?? 'Batch scrape failed')
        return
      }
      setBatchResult(data)
    } catch (e: unknown) {
      setBatchError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setBatchLoading(false)
    }
  }

  return (
    <div className="space-y-8">
      <div className="rounded-2xl border border-gray-800 bg-gray-900/60 p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Target Namespace</p>
        <p className="text-xs text-gray-500 mt-1">This tab uses the namespace from the top bar for queue submission.</p>
        <p className="mt-2 text-sm font-mono text-gray-200">{namespace}</p>
      </div>

      <div className="space-y-4 rounded-2xl border border-gray-800 bg-gray-900/40 p-5">
        <div>
          <SectionLabel>Batch Scrape</SectionLabel>
          <p className="text-sm text-gray-400">Provide one URL per line. Successful URLs are queued for approval.</p>
        </div>

        <Field label="URLs">
          <textarea
            value={batchUrls}
            onChange={(e) => setBatchUrls(e.target.value)}
            rows={8}
            className={`${inputCls} resize-y font-mono text-xs`}
            placeholder={"https://example.com/page-1\nhttps://example.com/page-2"}
          />
        </Field>

        <div className="flex flex-wrap items-end gap-3">
          <div className="w-32">
            <Field label="Concurrency">
              <input
                type="number"
                min={1}
                max={6}
                value={batchConcurrency}
                onChange={(e) => setBatchConcurrency(Number(e.target.value) || 1)}
                className={inputCls}
              />
            </Field>
          </div>
          <button onClick={runBatchScrape} disabled={batchLoading || parseUrls(batchUrls).length === 0} className={btnPrimary}>
            {batchLoading ? 'Processing…' : 'Run Batch'}
          </button>
        </div>

        <div className="rounded-xl border border-gray-800 bg-gray-900/60 px-4 py-3 text-xs text-gray-400">
          Namespace: <span className="font-mono text-gray-200">{namespace}</span>
          <span className="mx-2 text-gray-600">|</span>
          Approval queue only, no auto ingest
        </div>

        {batchError && (
          <p className="text-sm text-red-400 bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2">{batchError}</p>
        )}

        {batchResult && (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-4">
              <div className="rounded-xl border border-gray-700 bg-gray-900/70 p-3">
                <p className="text-xs text-gray-500">Total</p>
                <p className="text-lg font-semibold text-white">{batchResult.total}</p>
              </div>
              <div className="rounded-xl border border-gray-700 bg-gray-900/70 p-3">
                <p className="text-xs text-gray-500">Succeeded</p>
                <p className="text-lg font-semibold text-green-400">{batchResult.succeeded}</p>
              </div>
              <div className="rounded-xl border border-gray-700 bg-gray-900/70 p-3">
                <p className="text-xs text-gray-500">Failed</p>
                <p className="text-lg font-semibold text-red-400">{batchResult.failed}</p>
              </div>
              <div className="rounded-xl border border-gray-700 bg-gray-900/70 p-3">
                <p className="text-xs text-gray-500">Mode</p>
                <p className="text-lg font-semibold text-white">Approval queue</p>
              </div>
              <div className="rounded-xl border border-gray-700 bg-gray-900/70 p-3">
                <p className="text-xs text-gray-500">Queued</p>
                <p className="text-lg font-semibold text-cyan-400">{batchResult.approval_submitted ?? 0}</p>
              </div>
            </div>

            <div className="space-y-3">
              {batchResult.items.map((item) => (
                <div key={item.url} className="rounded-xl border border-gray-700 bg-gray-900/70 p-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white break-all">{item.title || item.url}</p>
                      <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:underline break-all">
                        {item.url}
                      </a>
                    </div>
                    <span className="text-xs px-2 py-0.5 rounded border border-gray-700 text-gray-300 shrink-0">
                      {item.status}
                    </span>
                  </div>
                  {item.approval_candidate_id && (
                    <p className="text-xs text-cyan-300">
                      Queued for approval: <a href={`/approvals/${item.approval_candidate_id}`} className="underline hover:text-cyan-200">{item.approval_candidate_id}</a>
                    </p>
                  )}
                  {item.text_preview && (
                    <p className="text-xs text-gray-400 leading-relaxed whitespace-pre-wrap">{item.text_preview}</p>
                  )}
                  {item.error && (
                    <p className="text-xs text-red-400">{item.error}</p>
                  )}
                  {item.reason && (
                    <p className="text-xs text-amber-300">{item.reason}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main Playground ──────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  {
    id: 'ingest',
    label: 'Ingest',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
      </svg>
    ),
  },
  {
    id: 'harvest',
    label: 'Knowledge Harvest',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v18m9-9H3m16.5-6.5L12 12l7.5 7.5M4.5 5.5L12 12l-7.5 7.5" />
      </svg>
    ),
  },
]

export default function PlaygroundUI() {
  const [tab, setTab] = useState<Tab>('ingest')
  const [namespace, setNamespace] = useState('default')

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 pt-6 pb-0 border-b border-gray-800">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-white">Knowledge Playground</h2>
          <p className="text-xs text-gray-400 mt-0.5">Ingest documents and harvest web knowledge into the Knowledge Base</p>
        </div>
        {/* Tabs */}
        <div className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors border-b-2 -mb-px ${
                tab === t.id
                  ? 'text-white border-purple-500 bg-gray-800/40'
                  : 'text-gray-400 border-transparent hover:text-gray-300 hover:border-gray-600'
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
        <div className="mt-4 mb-4 flex items-center gap-3 rounded-2xl border border-gray-800 bg-gray-900/60 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Target Namespace</p>
            <p className="text-xs text-gray-500 mt-0.5">Used by ingest and harvest actions.</p>
          </div>
          <div className="w-full max-w-md">
            <NamespaceInput
              value={namespace}
              onChange={setNamespace}
              saveDescription={async (ns, desc) => {
                await fetch('/api/namespaces', {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ namespace: ns, description: desc }),
                })
              }}
            />
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl">
          {tab === 'ingest' && <IngestTab namespace={namespace} setNamespace={setNamespace} />}
          {tab === 'harvest' && <KnowledgeHarvestTab namespace={namespace} setNamespace={setNamespace} />}
        </div>
      </div>
    </div>
  )
}
