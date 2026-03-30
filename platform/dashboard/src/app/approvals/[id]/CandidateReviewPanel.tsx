'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Status = 'pending' | 'approved' | 'rejected' | 'expired'

interface Props {
  id: string
  initialContent: string
  status: Status
  sourceRequestId: string
  sourceType: string
  sourceLabel?: string | null
  sourceUrl?: string | null
  sourceTitle?: string | null
  sourceSummary?: string | null
  sourceMetadata?: Record<string, unknown>
  confidenceScore: number
  proposedAt: string
  expiresAt: string
  targetNamespace: string
}

// ── Infer candidate origin from content ────────────────────────────────────
function inferSource(content: string, sourceRequestId: string, sourceType: string): {
  label: string
  detail: string
  color: string
} {
  if (sourceType === 'web_ingest') {
    return {
      label: 'Web ingest',
      detail: 'The candidate was created from a web source. Review the submitted content and source metadata before approving.',
      color: 'text-cyan-400',
    }
  }
  if (sourceType === 'text_ingest') {
    return {
      label: 'Text ingest',
      detail: 'The candidate was created from a text submission. Review the content before approving.',
      color: 'text-purple-400',
    }
  }
  if (sourceType === 'file_ingest') {
    return {
      label: 'File ingest',
      detail: 'The candidate was created from a file submission. Review the extracted content before approving.',
      color: 'text-emerald-400',
    }
  }
  if (sourceType === 'knowledge_gap') {
    return {
      label: 'Knowledge gap',
      detail: 'This candidate came from a logged knowledge gap. Review the draft content before approving.',
      color: 'text-blue-400',
    }
  }
  if (sourceType === 'knowledge_harvest') {
    return {
      label: 'Knowledge Harvest',
      detail: 'This candidate came from a harvested web source. Review the submitted content and metadata before approving.',
      color: 'text-sky-400',
    }
  }
  if (sourceType === 'feedback' || sourceType === 'feedback_cluster') {
    return {
      label: sourceType === 'feedback' ? 'Low-feedback interaction' : 'Feedback cluster',
      detail: 'This candidate came from user feedback analysis. Review the proposed content and supporting signal before approving.',
      color: 'text-amber-400',
    }
  }
  if (sourceType === 'manual') {
    return {
      label: 'Manual candidate',
      detail: 'This candidate was added manually for review.',
      color: 'text-gray-400',
    }
  }
  if (content.includes('[Promoted from knowledge gap')) {
    return {
      label: 'Knowledge Gap (manual promote)',
      detail: 'Admin promoted this gap from the Knowledge Gaps page. The answer is empty and needs to be filled in before approving.',
      color: 'text-blue-400',
    }
  }
  if (content.includes('[Knowledge gap')) {
    return {
      label: 'Knowledge Gap (auto-promoted)',
      detail: 'This gap appeared multiple times and was automatically promoted by the scheduler. The answer is empty and needs to be filled in before approving.',
      color: 'text-blue-400',
    }
  }
  if (sourceRequestId) {
    return {
      label: 'Low-confidence answer',
      detail: `Detected from interaction log (request: ${sourceRequestId.slice(0, 8)}…). The LLM answered with low confidence — review and enrich before approving.`,
      color: 'text-yellow-400',
    }
  }
  return {
    label: 'Unknown origin',
    detail: 'Source could not be determined.',
    color: 'text-gray-400',
  }
}

// ── Diff view ──────────────────────────────────────────────────────────────
function DiffView({ original, edited }: { original: string; edited: string }) {
  const origLines = original.split('\n')
  const editLines = edited.split('\n')
  const maxLen = Math.max(origLines.length, editLines.length)

  return (
    <div className="mt-4 grid grid-cols-2 gap-3">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1.5">Original</p>
        <div className="rounded-lg bg-gray-950 border border-gray-700 overflow-auto max-h-64 font-mono text-xs leading-relaxed">
          {Array.from({ length: maxLen }).map((_, i) => {
            const line = origLines[i] ?? ''
            const changed = line !== (editLines[i] ?? '')
            return (
              <div key={i} className={`px-3 py-0.5 ${changed ? 'bg-red-900/30 text-red-300' : 'text-gray-400'}`}>
                {line || <span className="opacity-0">·</span>}
              </div>
            )
          })}
        </div>
      </div>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1.5">Modified</p>
        <div className="rounded-lg bg-gray-950 border border-gray-700 overflow-auto max-h-64 font-mono text-xs leading-relaxed">
          {Array.from({ length: maxLen }).map((_, i) => {
            const line = editLines[i] ?? ''
            const changed = line !== (origLines[i] ?? '')
            return (
              <div key={i} className={`px-3 py-0.5 ${changed ? 'bg-green-900/30 text-green-300' : 'text-gray-400'}`}>
                {line || <span className="opacity-0">·</span>}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Knowledge path diagram ─────────────────────────────────────────────────
function KnowledgePath({ namespace }: { namespace: string }) {
  return (
    <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
      <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">
        Knowledge Path — How this will be ingested
      </h2>
      <div className="flex items-start gap-3">
        {/* Step 1 */}
        <div className="flex flex-col items-center gap-1.5 flex-1">
          <div className="w-9 h-9 rounded-lg bg-purple-500/20 border border-purple-500/30 flex items-center justify-center">
            <svg className="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <p className="text-xs text-purple-400 font-medium text-center">Text</p>
          <p className="text-xs text-gray-500 text-center leading-tight">Approved content</p>
        </div>

        <div className="flex-none pt-4 text-gray-600">→</div>

        {/* Step 2 */}
        <div className="flex flex-col items-center gap-1.5 flex-1">
          <div className="w-9 h-9 rounded-lg bg-gray-700 border border-gray-600 flex items-center justify-center">
            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
            </svg>
          </div>
          <p className="text-xs text-gray-300 font-medium text-center">Chunking</p>
          <p className="text-xs text-gray-500 text-center leading-tight">Split into passages</p>
        </div>

        <div className="flex-none pt-4 text-gray-600">→</div>

        {/* Step 3 */}
        <div className="flex flex-col items-center gap-1.5 flex-1">
          <div className="w-9 h-9 rounded-lg bg-gray-700 border border-gray-600 flex items-center justify-center">
            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <p className="text-xs text-gray-300 font-medium text-center">Embedding</p>
          <p className="text-xs text-gray-500 text-center leading-tight">Vector encoding</p>
        </div>

        <div className="flex-none pt-4 text-gray-600">→</div>

        {/* Step 4 — 3 stores */}
        <div className="flex flex-col gap-2 flex-[2]">
          <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-2">
            <div className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
            <div>
              <p className="text-xs text-green-400 font-medium">ChromaDB</p>
              <p className="text-xs text-gray-500">Vector search index</p>
              <p className="text-[10px] font-mono text-purple-400 mt-0.5">ns: {namespace}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 bg-blue-500/10 border border-blue-500/20 rounded-lg px-3 py-2">
            <div className="w-2 h-2 rounded-full bg-blue-400 shrink-0" />
            <div>
              <p className="text-xs text-blue-400 font-medium">Neo4j</p>
              <p className="text-xs text-gray-500">Entity & relation graph</p>
            </div>
          </div>
          <div className="flex items-center gap-2 bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-3 py-2">
            <div className="w-2 h-2 rounded-full bg-yellow-400 shrink-0" />
            <div>
              <p className="text-xs text-yellow-400 font-medium">PostgreSQL</p>
              <p className="text-xs text-gray-500">Document metadata</p>
            </div>
          </div>
        </div>
      </div>
      <p className="text-xs text-gray-600 mt-4">
        After approval, the content goes through the ingestion pipeline — chunked, embedded, and stored in all three stores. It will be searchable immediately after ingestion completes.
      </p>
    </div>
  )
}

// ── Main panel ─────────────────────────────────────────────────────────────
export default function CandidateReviewPanel({
  id,
  initialContent,
  status,
  sourceRequestId,
  sourceType,
  sourceLabel,
  sourceUrl,
  sourceTitle,
  sourceSummary,
  sourceMetadata,
  confidenceScore,
  proposedAt,
  expiresAt,
  targetNamespace,
}: Props) {
  const router = useRouter()
  const [content, setContent] = useState(initialContent)
  const [namespace, setNamespace] = useState(targetNamespace)
  const [loading, setLoading] = useState<'approve' | 'reject' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<'approved' | 'rejected' | null>(null)

  const source = inferSource(initialContent, sourceRequestId, sourceType)
  const confidencePct = Math.min(Math.max(confidenceScore * 100, 0), 100)
  const barColor = confidencePct >= 80 ? 'bg-green-500' : confidencePct >= 60 ? 'bg-yellow-500' : 'bg-red-500'
  const sourceMeta = sourceMetadata ?? {}

  async function handleAction(action: 'approve' | 'reject') {
    setLoading(action)
    setError(null)
    try {
      const res = await fetch(`/api/approvals/${id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'approve' ? { content, target_namespace: namespace } : {}),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error || `Request failed with status ${res.status}`)
      }
      setDone(action === 'approve' ? 'approved' : 'rejected')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="space-y-6">

      {/* Source & Origin */}
      <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
          Source & Origin
        </h2>
        <div className="flex items-start gap-3">
          <div className="w-2 h-2 rounded-full mt-1.5 shrink-0 bg-current" style={{ color: 'currentColor' }}>
            <div className={`w-2 h-2 rounded-full ${source.color.replace('text-', 'bg-')}`} />
          </div>
          <div>
            <p className={`text-sm font-semibold ${source.color}`}>{source.label}</p>
            <p className="text-xs text-gray-400 mt-1 leading-relaxed">{source.detail}</p>
            {sourceLabel && (
              <p className="text-xs text-gray-500 mt-1">Label: {sourceLabel}</p>
            )}
            {sourceTitle && (
              <p className="text-xs text-gray-500 mt-1">Title: {sourceTitle}</p>
            )}
            {sourceUrl && (
              <p className="text-xs text-cyan-400 mt-1 break-all">
                URL: {sourceUrl}
              </p>
            )}
            {sourceSummary && (
              <p className="text-xs text-gray-500 mt-1 leading-relaxed">{sourceSummary}</p>
            )}
            {Object.keys(sourceMeta).length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-300">Source metadata</summary>
                <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-gray-950 border border-gray-700 p-3 text-[10px] text-gray-400 whitespace-pre-wrap">
                  {JSON.stringify(sourceMeta, null, 2)}
                </pre>
              </details>
            )}
            {sourceRequestId && (
              <p className="text-xs text-gray-600 mt-1.5 font-mono">
                request_id: {sourceRequestId}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Confidence Score */}
      <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
          Retrieval Confidence Score
        </h2>
        <div className="flex items-center gap-3">
          <div className="flex-1 bg-gray-700 rounded-full h-2.5">
            <div className={`${barColor} h-2.5 rounded-full`} style={{ width: `${confidencePct}%` }} />
          </div>
          <span className="text-lg font-bold text-white w-14 text-right">
            {confidencePct.toFixed(1)}%
          </span>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          Score of the best-matching chunk at query time. Below threshold triggered this candidate.
        </p>
      </div>

      {/* Content Editor */}
      <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            Content to Ingest
          </h2>
          {status === 'pending' && (
            <span className="text-xs text-gray-500">
              {content.length} chars — editable before approving
            </span>
          )}
        </div>
        {status === 'pending' ? (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={12}
            className="w-full bg-gray-900 border border-gray-600 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-lg p-4 text-sm text-gray-200 font-mono leading-relaxed resize-y outline-none transition-colors"
            placeholder="Enter the knowledge content to be ingested…"
          />
        ) : (
          <pre className="text-sm text-gray-200 leading-relaxed whitespace-pre-wrap font-mono bg-gray-900 rounded-lg p-4">
            {content}
          </pre>
        )}
        {status === 'pending' && content !== initialContent && (
          <>
            <div className="flex items-center justify-between mt-2">
              <p className="text-xs text-blue-400">Content modified — approve will ingest your edited version</p>
              <button
                onClick={() => setContent(initialContent)}
                className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
              >
                Reset
              </button>
            </div>
            <DiffView original={initialContent} edited={content} />
          </>
        )}
      </div>

      {/* Target Namespace */}
      <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            Target Namespace
          </h2>
          {namespace !== targetNamespace && (
            <button
              onClick={() => setNamespace(targetNamespace)}
              className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
            >
              Reset
            </button>
          )}
        </div>
        {status === 'pending' ? (
          <div className="space-y-1.5">
            <input
              value={namespace}
              onChange={(e) => setNamespace(e.target.value)}
              placeholder="default"
              className="w-full bg-gray-900 border border-gray-600 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 rounded-lg px-3 py-2 text-sm text-gray-200 font-mono outline-none transition-colors"
            />
            {namespace !== targetNamespace && (
              <p className="text-xs text-purple-400">
                Changed from <span className="font-mono">{targetNamespace}</span> — will ingest to <span className="font-mono">{namespace || 'default'}</span>
              </p>
            )}
            <p className="text-xs text-gray-600">Namespace where this knowledge will be stored after approval</p>
          </div>
        ) : (
          <p className="text-sm font-mono text-purple-300">{namespace}</p>
        )}
      </div>

      {/* Knowledge Path */}
      <KnowledgePath namespace={namespace || 'default'} />

      {/* Timeline */}
      <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
          Timeline
        </h2>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-gray-500 text-xs">Proposed At</p>
            <p className="text-gray-200 mt-0.5">{new Date(proposedAt).toLocaleString()}</p>
          </div>
          <div>
            <p className="text-gray-500 text-xs">Expires At</p>
            <p className="text-gray-200 mt-0.5">{new Date(expiresAt).toLocaleString()}</p>
          </div>
        </div>
      </div>

      {/* Decision */}
      {status === 'pending' && (
        <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">
            Decision
          </h2>

          {done ? (
            <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium ${
              done === 'approved'
                ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                : 'bg-red-500/20 text-red-400 border border-red-500/30'
            }`}>
              {done === 'approved'
                ? <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              }
              Candidate {done}
              {done === 'approved' && <span className="text-xs opacity-70 ml-1">— ingestion queued</span>}
            </div>
          ) : (
            <>
              {error && (
                <div className="bg-red-900/30 border border-red-700 rounded-lg p-3 text-red-400 text-sm mb-3">
                  {error}
                </div>
              )}
              {!content.trim() && (
                <div className="bg-yellow-900/30 border border-yellow-700 rounded-lg p-3 text-yellow-400 text-xs mb-3">
                  Content is empty — please fill in the knowledge before approving.
                </div>
              )}
              <div className="flex items-center gap-3">
                <button
                  onClick={() => handleAction('approve')}
                  disabled={loading !== null || !content.trim()}
                  className="flex items-center gap-2 px-5 py-2.5 bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
                >
                  {loading === 'approve'
                    ? <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                    : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                  }
                  Approve & Ingest
                </button>
                <button
                  onClick={() => handleAction('reject')}
                  disabled={loading !== null}
                  className="flex items-center gap-2 px-5 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
                >
                  {loading === 'reject'
                    ? <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                    : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  }
                  Reject
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
