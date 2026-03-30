import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { getCandidate } from '@/lib/api'
import CandidateReviewPanel from './CandidateReviewPanel'
import { requireAdminPageSession } from '@/lib/authz'

export default async function CandidateDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireAdminPageSession()
  const { id } = await params

  let candidate
  try {
    candidate = await getCandidate(id)
  } catch {
    notFound()
  }

  const statusColors: Record<string, string> = {
    pending: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    approved: 'bg-green-500/20 text-green-400 border-green-500/30',
    rejected: 'bg-red-500/20 text-red-400 border-red-500/30',
    expired: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  }

  return (
    <div className="p-8 max-w-3xl">
      {/* Back link */}
      <Link
        href="/approvals"
        className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white mb-6 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to Approvals
      </Link>

      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-2xl font-bold text-white">Candidate Review</h1>
          <span
            className={`text-xs font-medium px-2.5 py-1 rounded-full border ${statusColors[candidate.status] ?? ''}`}
          >
            {candidate.status}
          </span>
        </div>
        <p className="text-xs text-gray-500 font-mono">ID: {candidate.id}</p>
      </div>

      <CandidateReviewPanel
        id={candidate.id}
        initialContent={candidate.proposed_content}
        status={candidate.status as 'pending' | 'approved' | 'rejected' | 'expired'}
        sourceRequestId={candidate.source_request_id ?? ''}
        sourceType={candidate.source_type ?? 'interaction'}
        sourceLabel={candidate.source_label ?? undefined}
        sourceUrl={candidate.source_url ?? undefined}
        sourceTitle={candidate.source_title ?? undefined}
        sourceSummary={candidate.source_summary ?? undefined}
        sourceMetadata={candidate.source_metadata ?? {}}
        confidenceScore={candidate.confidence_score}
        proposedAt={candidate.proposed_at ?? candidate.created_at}
        expiresAt={candidate.expires_at}
        targetNamespace={candidate.target_namespace ?? 'default'}
      />
    </div>
  )
}
