'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

interface QueueStats {
  queue_depth: number
  processing: number
  failed_total: number
  recent_failures: { job_id: string; filename: string; error: string }[]
}

interface JobItem {
  job_id: string
  status: string
  progress: number
  filename: string
  mime_type: string
  namespace: string
  content_source: string
  source_url?: string | null
  retry_count: number
  max_retries: number
  error: string | null
  created_at: number
  updated_at: number
}

interface JobPreview {
  job_id: string
  filename: string
  namespace: string
  mime_type: string
  content_source: string
  content_kind: string
  total_bytes: number
  preview_text: string
  truncated: boolean
}

interface JobListResponse {
  items: JobItem[]
  total: number
  page: number
  page_size: number
  total_pages: number
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    queued: 'text-yellow-400 border-yellow-800/50 bg-yellow-900/20',
    processing: 'text-blue-400 border-blue-800/50 bg-blue-900/20',
    processing_graph: 'text-amber-300 border-amber-800/50 bg-amber-900/20',
    cancelled: 'text-gray-300 border-gray-700 bg-gray-800',
    done: 'text-green-400 border-green-800/50 bg-green-900/20',
    failed: 'text-red-400 border-red-800/50 bg-red-900/20',
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded border font-mono ${colors[status] ?? 'text-gray-400 border-gray-700 bg-gray-800'}`}>
      {status}
    </span>
  )
}

function ProgressBar({ value, status }: { value: number; status: string }) {
  const barClass =
    status === 'failed'
      ? 'bg-red-500'
      : status === 'cancelled'
        ? 'bg-gray-500'
      : status === 'processing_graph'
        ? 'bg-amber-400'
        : status === 'processing'
          ? 'bg-blue-500'
          : 'bg-green-500'

  return (
    <div className="w-full bg-gray-800 rounded-full h-1.5">
      <div
        className={`${barClass} h-1.5 rounded-full transition-all duration-300`}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  )
}

function fmtDate(ts: number) {
  if (!ts) return '—'
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(ts * 1000))
}

function shortId(jobId: string) {
  return jobId.length > 12 ? `${jobId.slice(0, 8)}…${jobId.slice(-4)}` : jobId
}

export default function JobQueueUI() {
  const [stats, setStats] = useState<QueueStats | null>(null)
  const [jobs, setJobs] = useState<JobListResponse | null>(null)
  const [loadingStats, setLoadingStats] = useState(true)
  const [loadingJobs, setLoadingJobs] = useState(true)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [retrying, setRetrying] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState<string | null>(null)
  const [reprocessing, setReprocessing] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState<string | null>(null)
  const [preview, setPreview] = useState<JobPreview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)

  const [draftStatus, setDraftStatus] = useState('all')
  const [draftNamespace, setDraftNamespace] = useState('')
  const [draftQuery, setDraftQuery] = useState('')
  const [draftSort, setDraftSort] = useState('latest')
  const [status, setStatus] = useState('all')
  const [namespace, setNamespace] = useState('')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('latest')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch('/api/jobs', { cache: 'no-store' })
      setStats(res.ok ? await res.json() : null)
    } catch {
      setStats(null)
    } finally {
      setLoadingStats(false)
    }
  }, [])

  const loadJobs = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      params.set('page', String(page))
      params.set('page_size', String(pageSize))
      params.set('sort', sort)
      if (status !== 'all') params.set('status', status)
      if (namespace.trim()) params.set('namespace', namespace.trim())
      if (query.trim()) params.set('query', query.trim())
      const res = await fetch(`/api/jobs/list?${params.toString()}`, { cache: 'no-store' })
      setJobs(res.ok ? await res.json() : null)
      setLastUpdated(new Date())
    } catch {
      setJobs(null)
    } finally {
      setLoadingJobs(false)
    }
  }, [page, pageSize, sort, status, namespace, query])

  useEffect(() => {
    loadStats()
    loadJobs()
  }, [loadStats, loadJobs])

  useEffect(() => {
    if (!autoRefresh) return
    const id = setInterval(() => {
      loadStats()
      loadJobs()
    }, 5000)
    return () => clearInterval(id)
  }, [loadStats, loadJobs, autoRefresh])

  const summaryTotal = useMemo(() => {
    if (!jobs) return 0
    return jobs.total
  }, [jobs])

  async function retry(job_id: string) {
    setRetrying(job_id)
    try {
      await fetch(`/api/jobs/${job_id}/retry`, { method: 'POST' })
      await Promise.all([loadStats(), loadJobs()])
    } finally {
      setRetrying(null)
    }
  }

  async function cancelJob(job_id: string) {
    setCancelling(job_id)
    try {
      await fetch(`/api/jobs/${job_id}/cancel`, { method: 'POST' })
      await Promise.all([loadStats(), loadJobs()])
    } finally {
      setCancelling(null)
    }
  }

  async function reprocessJob(job_id: string) {
    setReprocessing(job_id)
    try {
      await fetch(`/api/jobs/${job_id}/reprocess`, { method: 'POST' })
      await Promise.all([loadStats(), loadJobs()])
    } finally {
      setReprocessing(null)
    }
  }

  async function openPreview(job_id: string) {
    setPreviewing(job_id)
    setPreviewError(null)
    setPreview(null)
    try {
      const res = await fetch(`/api/jobs/${job_id}/preview`, { cache: 'no-store' })
      if (res.status === 404) {
        setPreviewError('Job not found')
        return
      }
      if (!res.ok) {
        setPreviewError(`Preview failed (${res.status})`)
        return
      }
      setPreview(await res.json())
    } catch {
      setPreviewError('Preview failed')
    } finally {
      setPreviewing(null)
    }
  }

  function applyFilters() {
    setStatus(draftStatus)
    setNamespace(draftNamespace)
    setQuery(draftQuery)
    setSort(draftSort)
    setPage(1)
  }

  function resetFilters() {
    setDraftStatus('all')
    setDraftNamespace('')
    setDraftQuery('')
    setDraftSort('latest')
    setStatus('all')
    setNamespace('')
    setQuery('')
    setSort('latest')
    setPage(1)
  }

  function canCancel(status: string) {
    return status === 'queued' || status === 'processing' || status === 'processing_graph'
  }

  function canReprocess(status: string) {
    return status === 'done' || status === 'failed' || status === 'cancelled'
  }

  const empty = !loadingJobs && (jobs?.items.length ?? 0) === 0

  return (
    <div className="min-h-full p-6 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Ingestion Jobs</h1>
            <p className="text-sm text-gray-400 mt-1">
              Browse queued, processing, graph, failed, and completed jobs with filters and paging.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            {lastUpdated && <span>Updated {lastUpdated.toLocaleTimeString()}</span>}
            <button
              onClick={() => setAutoRefresh((v) => !v)}
              className={`px-3 py-1.5 rounded-lg border transition-colors ${
                autoRefresh
                  ? 'border-green-700/50 text-green-400 bg-green-900/20'
                  : 'border-gray-700 text-gray-400 hover:border-gray-500'
              }`}
            >
              {autoRefresh ? 'Auto-refresh ON' : 'Auto-refresh OFF'}
            </button>
            <button
              onClick={() => { loadStats(); loadJobs() }}
              className="px-3 py-1.5 rounded-lg border border-gray-700 text-gray-300 hover:border-gray-500 transition-colors"
            >
              Refresh
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-4">
            <p className="text-xs text-gray-400 mb-1">Total Jobs</p>
            <p className="text-2xl font-bold text-white">{loadingJobs ? '—' : summaryTotal}</p>
            <p className="text-xs text-gray-500 mt-0.5">matching current filters</p>
          </div>
          <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-4">
            <p className="text-xs text-gray-400 mb-1">Queue Depth</p>
            <p className="text-2xl font-bold text-yellow-400">{loadingStats ? '—' : (stats?.queue_depth ?? 0)}</p>
            <p className="text-xs text-gray-500 mt-0.5">waiting to process</p>
          </div>
          <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-4">
            <p className="text-xs text-gray-400 mb-1">Processing</p>
            <p className="text-2xl font-bold text-blue-400">{loadingStats ? '—' : (stats?.processing ?? 0)}</p>
            <p className="text-xs text-gray-500 mt-0.5">including graph stage</p>
          </div>
          <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-4">
            <p className="text-xs text-gray-400 mb-1">Failed</p>
            <p className={`text-2xl font-bold ${(stats?.failed_total ?? 0) > 0 ? 'text-red-400' : 'text-gray-400'}`}>
              {loadingStats ? '—' : (stats?.failed_total ?? 0)}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">last 7 days</p>
          </div>
        </div>

        <div className="bg-gray-900/60 border border-gray-700/50 rounded-2xl p-4 lg:p-5 space-y-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 flex-1">
              <label className="space-y-1">
                <span className="text-xs text-gray-400">Search</span>
                <input
                  value={draftQuery}
                  onChange={(e) => setDraftQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
                  placeholder="job id, filename, namespace, error"
                  className="w-full bg-gray-800 border border-gray-700 focus:border-purple-600 rounded-lg px-3 py-2 text-sm text-white outline-none placeholder-gray-500"
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-gray-400">Namespace</span>
                <input
                  value={draftNamespace}
                  onChange={(e) => setDraftNamespace(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
                  placeholder="dohome.sap"
                  className="w-full bg-gray-800 border border-gray-700 focus:border-purple-600 rounded-lg px-3 py-2 text-sm text-white outline-none placeholder-gray-500"
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-gray-400">Status</span>
                <select
                  value={draftStatus}
                  onChange={(e) => setDraftStatus(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 focus:border-purple-600 rounded-lg px-3 py-2 text-sm text-white outline-none"
                >
                  <option value="all">All</option>
                  <option value="queued">Queued</option>
                  <option value="processing">Processing</option>
                  <option value="processing_graph">Processing graph</option>
                  <option value="cancelled">Cancelled</option>
                  <option value="done">Done</option>
                  <option value="failed">Failed</option>
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs text-gray-400">Sort</span>
                <select
                  value={draftSort}
                  onChange={(e) => setDraftSort(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 focus:border-purple-600 rounded-lg px-3 py-2 text-sm text-white outline-none"
                >
                  <option value="latest">Newest</option>
                  <option value="oldest">Oldest</option>
                </select>
              </label>
            </div>

            <div className="flex items-end gap-2">
              <label className="space-y-1">
                <span className="text-xs text-gray-400">Per page</span>
                <select
                  value={pageSize}
                  onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1) }}
                  className="w-24 bg-gray-800 border border-gray-700 focus:border-purple-600 rounded-lg px-3 py-2 text-sm text-white outline-none"
                >
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                </select>
              </label>
              <button
                onClick={applyFilters}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm rounded-lg transition-colors font-medium"
              >
                Apply
              </button>
              <button
                onClick={resetFilters}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm rounded-lg transition-colors"
              >
                Reset
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>
              Showing {jobs?.items.length ?? 0} of {jobs?.total ?? 0} jobs
            </span>
            <span>
              Page {jobs?.page ?? page} / {jobs?.total_pages ?? 1}
            </span>
          </div>

          <div className="overflow-hidden rounded-xl border border-gray-700/50">
            <div className="max-h-[56vh] overflow-y-auto">
              <table className="min-w-full divide-y divide-gray-800">
                <thead className="sticky top-0 bg-gray-900/95 backdrop-blur border-b border-gray-800">
                  <tr className="text-left text-xs uppercase tracking-wider text-gray-400">
                    <th className="px-4 py-3">Job</th>
                    <th className="px-4 py-3">Namespace</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Progress</th>
                    <th className="px-4 py-3">Updated</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800 bg-gray-950/40">
                  {loadingJobs && (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-gray-500">
                        Loading jobs…
                      </td>
                    </tr>
                  )}

                  {empty && (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center text-gray-500">
                        No jobs match the current filters.
                      </td>
                    </tr>
                  )}

                  {jobs?.items.map((job) => (
                    <tr key={job.job_id} className="hover:bg-gray-800/30 transition-colors">
                      <td className="px-4 py-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-white truncate max-w-[20rem]">
                              {job.filename || '(unnamed job)'}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2 text-xs text-gray-500 font-mono">
                            <span title={job.job_id}>{shortId(job.job_id)}</span>
                            <span>•</span>
                            <span>{job.content_source}</span>
                            <span>•</span>
                            <span>{job.mime_type}</span>
                          </div>
                          {job.error && <p className="text-xs text-red-400 truncate">{job.error}</p>}
                        </div>
                      </td>
                      <td className="px-4 py-4 text-sm text-gray-300 font-mono">
                        {job.namespace || 'default'}
                      </td>
                      <td className="px-4 py-4">
                        <div className="space-y-1.5">
                          <StatusBadge status={job.status} />
                          <div className="text-xs text-gray-500">
                            {job.retry_count}/{job.max_retries} retries
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4 w-[22%]">
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-xs text-gray-500">
                            <span>{job.progress}%</span>
                            <span className="font-mono">{fmtDate(job.updated_at)}</span>
                          </div>
                          <ProgressBar value={job.progress} status={job.status} />
                          {job.status === 'processing_graph' && (
                            <p className="text-xs text-amber-300">Graph extraction in progress</p>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-4 text-xs text-gray-500 font-mono">
                        {fmtDate(job.created_at)}
                      </td>
                      <td className="px-4 py-4 text-right">
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          {job.status === 'failed' && (
                            <button
                              onClick={() => retry(job.job_id)}
                              disabled={retrying === job.job_id}
                              className="text-xs px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors disabled:opacity-40"
                            >
                              {retrying === job.job_id ? 'Retrying…' : 'Retry'}
                            </button>
                          )}
                          {canCancel(job.status) && (
                            <button
                              onClick={() => cancelJob(job.job_id)}
                              disabled={cancelling === job.job_id}
                              className="text-xs px-3 py-1.5 rounded-lg border border-red-800/50 text-red-300 hover:bg-red-900/20 transition-colors disabled:opacity-40"
                            >
                              {cancelling === job.job_id ? 'Cancelling…' : 'Cancel'}
                            </button>
                          )}
                          {canReprocess(job.status) && (
                            <button
                              onClick={() => reprocessJob(job.job_id)}
                              disabled={reprocessing === job.job_id}
                              className="text-xs px-3 py-1.5 rounded-lg border border-cyan-800/50 text-cyan-300 hover:bg-cyan-900/20 transition-colors disabled:opacity-40"
                            >
                              {reprocessing === job.job_id ? 'Reprocessing…' : 'Reprocess'}
                            </button>
                          )}
                          <button
                            onClick={() => openPreview(job.job_id)}
                            disabled={previewing === job.job_id}
                            className="text-xs px-3 py-1.5 rounded-lg border border-amber-700/50 text-amber-300 hover:bg-amber-900/20 transition-colors disabled:opacity-40"
                          >
                            {previewing === job.job_id ? 'Loading…' : 'Preview'}
                          </button>
                          <button
                            onClick={() => navigator.clipboard?.writeText(job.job_id)}
                            className="text-xs px-3 py-1.5 rounded-lg border border-gray-700 text-gray-300 hover:border-gray-500 hover:text-white transition-colors"
                          >
                            Copy ID
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="text-xs text-gray-500">
              Page size {jobs?.page_size ?? pageSize}. Use filters to narrow the list before paging.
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={(jobs?.page ?? page) <= 1}
                className="px-3 py-2 rounded-lg border border-gray-700 text-gray-300 hover:border-gray-500 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Prev
              </button>
              <span className="text-sm text-gray-400 font-mono px-2">
                {jobs?.page ?? page} / {jobs?.total_pages ?? 1}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(jobs?.total_pages ?? p, p + 1))}
                disabled={(jobs?.page ?? page) >= (jobs?.total_pages ?? 1)}
                className="px-3 py-2 rounded-lg border border-gray-700 text-gray-300 hover:border-gray-500 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        </div>

        {(stats?.recent_failures?.length ?? 0) > 0 && (
          <div className="bg-gray-900/60 border border-gray-700/50 rounded-2xl p-4 lg:p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-red-400 uppercase tracking-wider">Recent Failures</p>
              <span className="text-xs text-gray-500">Quick retry queue</span>
            </div>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {stats!.recent_failures.map((f) => (
                <div key={f.job_id} className="rounded-xl border border-red-800/30 bg-red-950/20 p-3">
                  <p className="text-sm text-white font-medium truncate">{f.filename || 'Unknown file'}</p>
                  <p className="text-xs text-red-400 mt-1 truncate">{f.error || 'No error message'}</p>
                  <p className="text-xs text-gray-600 font-mono mt-1">{shortId(f.job_id)}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {preview && (
          <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="w-full max-w-5xl max-h-[90vh] overflow-hidden rounded-2xl border border-gray-700 bg-gray-950 shadow-2xl">
              <div className="flex items-start justify-between gap-3 border-b border-gray-800 p-4">
                <div>
                  <h2 className="text-lg font-semibold text-white">Job Preview</h2>
                  <p className="text-xs text-gray-500 font-mono mt-1">{preview.job_id}</p>
                </div>
                <button
                  onClick={() => setPreview(null)}
                  className="text-xs px-3 py-1.5 rounded-lg border border-gray-700 text-gray-300 hover:border-gray-500"
                >
                  Close
                </button>
              </div>
              <div className="grid gap-4 p-4 lg:grid-cols-[280px_1fr]">
                <div className="space-y-3 text-sm">
                  <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-3">
                    <p className="text-xs text-gray-500 uppercase tracking-wider">Filename</p>
                    <p className="mt-1 text-white break-words">{preview.filename}</p>
                  </div>
                  <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-3">
                    <p className="text-xs text-gray-500 uppercase tracking-wider">Namespace</p>
                    <p className="mt-1 text-white font-mono break-words">{preview.namespace}</p>
                  </div>
                  <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-3">
                    <p className="text-xs text-gray-500 uppercase tracking-wider">Source</p>
                    <p className="mt-1 text-white">{preview.content_source}</p>
                  </div>
                  <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-3">
                    <p className="text-xs text-gray-500 uppercase tracking-wider">MIME</p>
                    <p className="mt-1 text-white font-mono">{preview.mime_type}</p>
                  </div>
                  <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-3">
                    <p className="text-xs text-gray-500 uppercase tracking-wider">Payload</p>
                    <p className="mt-1 text-white">{preview.content_kind}</p>
                    <p className="text-xs text-gray-500 mt-1">{preview.total_bytes.toLocaleString()} bytes</p>
                    {preview.truncated && <p className="text-xs text-amber-300 mt-1">Preview truncated</p>}
                  </div>
                </div>
                <div className="rounded-2xl border border-gray-800 bg-gray-900/70 overflow-hidden">
                  <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Input Preview</p>
                    <button
                      onClick={() => navigator.clipboard?.writeText(preview.preview_text)}
                      className="text-xs px-3 py-1.5 rounded-lg border border-gray-700 text-gray-300 hover:border-gray-500"
                    >
                      Copy text
                    </button>
                  </div>
                  <pre className="max-h-[70vh] overflow-auto p-4 text-xs leading-6 text-gray-200 whitespace-pre-wrap break-words font-mono">
                    {preview.preview_text || '(empty preview)'}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        )}

        {previewError && (
          <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="w-full max-w-md rounded-2xl border border-gray-700 bg-gray-950 p-5">
              <h2 className="text-lg font-semibold text-white">Job Preview</h2>
              <p className="mt-2 text-sm text-red-400">{previewError}</p>
              <div className="mt-4 flex justify-end">
                <button
                  onClick={() => setPreviewError(null)}
                  className="px-3 py-1.5 rounded-lg border border-gray-700 text-gray-300 hover:border-gray-500"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
