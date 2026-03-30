import { Suspense } from 'react'
import { getMetricsSummary, getEvaluationSummary, getQueueStats, getNamespaces, getRateLimitStats, getGraphStats, getMemoryStats } from '@/lib/api'
import type { MetricsSummary, EvaluationSummary, QueueStats, NamespaceSummary, RateLimitStats, GraphStats, MemoryStats } from '@/types'
import RefreshButton from './RefreshButton'
import TriggerButtons from './TriggerButtons'
import { requireViewerPageSession } from '@/lib/authz'
import DashboardUI from './DashboardUI'

async function DashboardContent() {
  let metrics: MetricsSummary | null = null
  let evaluation: EvaluationSummary | null = null
  let queueStats: QueueStats | null = null
  let namespaces: NamespaceSummary[] = []
  let rateLimit: RateLimitStats | null = null
  let graphStats: GraphStats | null = null
  let memoryStats: MemoryStats | null = null
  let metricsError: string | null = null
  let evalError: string | null = null
  let namespaceError: string | null = null

  await Promise.allSettled([
    getMetricsSummary().then(d => { metrics = d }).catch(e => { metricsError = e instanceof Error ? e.message : 'Failed to load metrics' }),
    getEvaluationSummary().then(d => { evaluation = d }).catch(e => { evalError = e instanceof Error ? e.message : 'Failed to load evaluation data' }),
    getQueueStats().then(d => { queueStats = d }).catch(() => {}),
    getNamespaces().then(d => { namespaces = d }).catch(e => { namespaceError = e instanceof Error ? e.message : 'Failed to load namespaces' }),
    getRateLimitStats().then(d => { rateLimit = d }).catch(() => { rateLimit = metrics?.rate_limit ?? null }),
    getGraphStats().then(d => { graphStats = d }).catch(() => {}),
    getMemoryStats().then(d => { memoryStats = d }).catch(() => {}),
  ])

  return (
    <DashboardUI
      metrics={metrics}
      evaluation={evaluation}
      queueStats={queueStats}
      namespaces={Array.isArray(namespaces) ? namespaces : []}
      rateLimit={rateLimit}
      graphStats={graphStats}
      memoryStats={memoryStats}
      metricsError={metricsError}
      evalError={evalError}
      namespaceError={namespaceError}
    />
  )
}

export default async function DashboardPage() {
  await requireViewerPageSession()

  return (
    <div className="flex flex-col h-screen">
      {/* Action buttons row — sits above the UI component */}
      <div className="shrink-0 flex items-center justify-end gap-3 px-6 pt-3 bg-gray-950">
        <TriggerButtons />
        <RefreshButton />
      </div>

      <Suspense
        fallback={
          <div className="flex-1 flex items-center justify-center">
            <div className="text-gray-400 text-sm">Loading metrics…</div>
          </div>
        }
      >
        <DashboardContent />
      </Suspense>
    </div>
  )
}
