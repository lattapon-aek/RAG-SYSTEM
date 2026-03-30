import { NextRequest, NextResponse } from 'next/server'
import { requireOperatorApiSession } from '@/lib/authz'

const GRAPH_URL = process.env.GRAPH_SERVICE_URL ?? 'http://graph-service:8002'

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ namespace: string }> }
) {
  const session = await requireOperatorApiSession()
  if (session instanceof NextResponse) return session

  const { namespace } = await params
  try {
    const res = await fetch(`${GRAPH_URL}/graph/namespaces/${encodeURIComponent(namespace)}`, {
      method: 'DELETE',
      cache: 'no-store',
    })
    const data = await res.json().catch(() => ({ deleted: true }))
    if (!res.ok) return NextResponse.json({ error: data?.detail || `HTTP ${res.status}` }, { status: res.status })
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: 'Graph service unavailable' }, { status: 503 })
  }
}
