import { NextRequest, NextResponse } from 'next/server'
import { requireAdminApiSession } from '@/lib/authz'

const INTELLIGENCE_SERVICE_URL =
  process.env.INTELLIGENCE_SERVICE_URL || 'http://localhost:8003'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdminApiSession()
  if (session instanceof NextResponse) {
    return session
  }

  const { id } = await params
  const body = await req.json().catch(() => ({}))

  try {
    const upstream = await fetch(
      `${INTELLIGENCE_SERVICE_URL}/self-learning/approve/${id}`,
      {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          admin_user_id: session.user.name,
          content: body.content ?? null,
          target_namespace: body.target_namespace ?? null,
        }),
      }
    )

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
    console.error(`Failed to approve candidate ${id}:`, err)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
