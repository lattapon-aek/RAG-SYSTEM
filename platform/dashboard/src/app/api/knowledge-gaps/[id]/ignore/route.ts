import { NextRequest, NextResponse } from 'next/server'
import { requireAdminApiSession } from '@/lib/authz'

const RAG_SERVICE_URL = process.env.RAG_SERVICE_URL || 'http://localhost:8000'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdminApiSession()
  if (session instanceof NextResponse) {
    return session
  }

  const { id } = await params

  try {
    const upstream = await fetch(`${RAG_SERVICE_URL}/knowledge-gaps/${id}/ignore`, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'x-admin-user': session.user.name },
    })

    if (!upstream.ok) {
      const body = await upstream.json().catch(() => ({}))
      return NextResponse.json(
        { error: body?.detail || 'Upstream request failed' },
        { status: upstream.status }
      )
    }

    const data = await upstream.json().catch(() => ({ success: true }))
    return NextResponse.json(data)
  } catch (err) {
    console.error(`Failed to ignore gap ${id}:`, err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
