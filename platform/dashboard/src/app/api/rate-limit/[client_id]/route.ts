import { NextResponse } from 'next/server'
import { requireOperatorApiSession } from '@/lib/authz'

const RAG_URL = process.env.RAG_SERVICE_URL ?? 'http://rag-service:8000'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ client_id: string }> },
) {
  const session = await requireOperatorApiSession()
  if (session instanceof NextResponse) {
    return session
  }

  try {
    const { client_id } = await params
    const res = await fetch(`${RAG_URL}/rate-limit/${encodeURIComponent(client_id)}`, {
      cache: 'no-store',
    })
    const data = res.ok
      ? await res.json()
      : {
          client_id,
          requests_this_minute: 0,
          rpm_limit: 60,
          remaining_this_minute: null,
          has_override: false,
          override_source: null,
        }
    return NextResponse.json(data, { status: res.ok ? 200 : res.status })
  } catch {
    return NextResponse.json(
      {
        client_id: 'unknown',
        requests_this_minute: 0,
        rpm_limit: 60,
        remaining_this_minute: null,
        has_override: false,
        override_source: null,
      },
      { status: 500 },
    )
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ client_id: string }> },
) {
  const session = await requireOperatorApiSession()
  if (session instanceof NextResponse) {
    return session
  }

  try {
    const { client_id } = await params
    const body = await req.json()
    const res = await fetch(`${RAG_URL}/rate-limit/${encodeURIComponent(client_id)}`, {
      method: 'PATCH',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-User': session.user.name ?? session.user.id,
      },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({ error: 'Failed to update rate limit' }))
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: 'Failed to update rate limit' }, { status: 500 })
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ client_id: string }> },
) {
  const session = await requireOperatorApiSession()
  if (session instanceof NextResponse) {
    return session
  }

  try {
    const { client_id } = await params
    const res = await fetch(`${RAG_URL}/rate-limit/${encodeURIComponent(client_id)}`, {
      method: 'DELETE',
      cache: 'no-store',
      headers: {
        'X-Admin-User': session.user.name ?? session.user.id,
      },
    })
    const data = await res.json().catch(() => ({ error: 'Failed to reset rate limit override' }))
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: 'Failed to reset rate limit override' }, { status: 500 })
  }
}
