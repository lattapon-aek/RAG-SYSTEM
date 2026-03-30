import { Suspense } from 'react'
import { getKnowledgeGaps } from '@/lib/api'
import type { KnowledgeGap } from '@/types'
import GapsView from './GapsView'
import { requireAdminPageSession } from '@/lib/authz'

async function GapsContent() {
  let gaps: KnowledgeGap[] = []
  let error: string | null = null

  try {
    gaps = await getKnowledgeGaps()
  } catch (e) {
    error = e instanceof Error ? e.message : 'Failed to load knowledge gaps'
  }

  if (error) {
    return (
      <div className="bg-red-900/30 border border-red-700 rounded-xl p-4 text-red-400 text-sm">
        {error}
      </div>
    )
  }

  return <GapsView gaps={gaps} />
}

export default async function KnowledgeGapsPage() {
  await requireAdminPageSession()

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Knowledge Gaps</h1>
        <p className="text-sm text-gray-400 mt-1">
          Queries with low retrieval scores — promote to approval queue or ignore
        </p>
      </div>
      <Suspense fallback={<div className="flex items-center justify-center py-24"><div className="text-gray-400 text-sm">Loading knowledge gaps…</div></div>}>
        <GapsContent />
      </Suspense>
    </div>
  )
}
