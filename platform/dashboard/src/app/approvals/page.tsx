import { Suspense } from 'react'
import { getCandidates } from '@/lib/api'
import type { KnowledgeCandidate } from '@/types'
import ApprovalsView from './ApprovalsView'
import { requireAdminPageSession } from '@/lib/authz'

async function ApprovalsContent() {
  let candidates: KnowledgeCandidate[] = []
  let error: string | null = null

  try {
    candidates = await getCandidates()
  } catch (e) {
    error = e instanceof Error ? e.message : 'Failed to load candidates'
  }

  if (error) {
    return (
      <div className="bg-red-900/30 border border-red-700 rounded-xl p-4 text-red-400 text-sm">
        {error}
      </div>
    )
  }

  return <ApprovalsView candidates={candidates} />
}

export default async function ApprovalsPage() {
  await requireAdminPageSession()

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Approval Queue</h1>
        <p className="text-sm text-gray-400 mt-1">
          Review text, web, and self-learning candidates before publishing to RAG
        </p>
      </div>
      <Suspense fallback={<div className="flex items-center justify-center py-24"><div className="text-gray-400 text-sm">Loading candidates…</div></div>}>
        <ApprovalsContent />
      </Suspense>
    </div>
  )
}
