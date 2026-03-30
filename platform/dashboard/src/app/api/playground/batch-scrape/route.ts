import { NextRequest, NextResponse } from 'next/server'
import { requireOperatorApiSession } from '@/lib/authz'
import {
  buildHarvestApprovalCandidatePayload,
  type KnowledgeHarvestItem,
} from '@/lib/ingest-preview'

const KC_URL = process.env.KNOWLEDGE_CONNECTOR_URL ?? 'http://knowledge-connector:8006'
const INTELLIGENCE_SERVICE_URL = process.env.INTELLIGENCE_SERVICE_URL ?? 'http://localhost:8003'

export async function POST(req: NextRequest) {
  const session = await requireOperatorApiSession()
  if (session instanceof NextResponse) {
    return session
  }

  const body = await req.json()
  const requestPayload = {
    ...body,
    auto_ingest: false,
  }
  const res = await fetch(`${KC_URL}/knowledge/batch-scrape`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestPayload),
  })
  const data = await res.json()
  if (!res.ok) {
    return Response.json(data, { status: res.status })
  }

  const namespace = String(body.namespace ?? 'default').trim() || 'default'
  const items = Array.isArray(data?.items) ? data.items : []
  const approvalResults = await Promise.all(
    items.map(async (item: KnowledgeHarvestItem) => {
      if (!item || item.status !== 'previewed') {
        return { url: item?.url, skipped: true }
      }

      const payload = buildHarvestApprovalCandidatePayload(
        item,
        namespace,
        `knowledge-harvest:${item.url}`,
      )

      if (!String(payload.proposed_content ?? '').trim()) {
        return { url: item.url, skipped: true, reason: 'empty content' }
      }

      const upstream = await fetch(`${INTELLIGENCE_SERVICE_URL}/self-learning/candidates`, {
        method: 'POST',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-user': session.user.name,
        },
        body: JSON.stringify(payload),
      })

      if (!upstream.ok) {
        const err = await upstream.json().catch(() => ({}))
        return {
          url: item.url,
          skipped: false,
          error: err?.detail || err?.error || 'Failed to create approval candidate',
        }
      }

      const candidate = await upstream.json().catch(() => ({}))
      return {
        url: item.url,
        candidate_id: candidate?.id ?? null,
        skipped: false,
      }
    }),
  )

  const queuedCount = approvalResults.filter((r) => r.candidate_id).length
  const mergedItems = items.map((item: Record<string, unknown>) => {
    const approval = approvalResults.find((r) => r.url === item.url)
    return {
      ...item,
      status: approval?.candidate_id ? 'queued' : item.status,
      approval_candidate_id: approval?.candidate_id ?? null,
      approval_error: approval?.error ?? null,
      approval_queued: Boolean(approval?.candidate_id),
    }
  })

  return Response.json({
    ...data,
    auto_ingest: false,
    approval_submitted: queuedCount,
    items: mergedItems,
  }, { status: res.status })
}
