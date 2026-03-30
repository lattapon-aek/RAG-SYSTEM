import { NextResponse } from 'next/server'
import { requireAdminApiSession } from '@/lib/authz'

const INTELLIGENCE_SERVICE_URL =
  process.env.INTELLIGENCE_SERVICE_URL || 'http://localhost:8003'

export async function POST() {
  const session = await requireAdminApiSession()
  if (session instanceof NextResponse) {
    return session
  }

  try {
    const upstream = await fetch(`${INTELLIGENCE_SERVICE_URL}/self-learning/process-gaps`, {
      method: 'POST',
      cache: 'no-store',
    })

    if (!upstream.ok) {
      const body = await upstream.json().catch(() => ({}))
      return NextResponse.json(
        { error: body?.detail || 'Upstream request failed' },
        { status: upstream.status }
      )
    }

    const data = await upstream.json().catch(() => ({ promoted: 0 }))
    return NextResponse.json(data)
  } catch (err) {
    console.error('Failed to process gaps:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
