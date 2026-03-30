import { NextResponse } from 'next/server'
import { requireAdminApiSession } from '@/lib/authz'

const RAG_URL = process.env.RAG_SERVICE_URL ?? 'http://rag-service:8000'

export async function GET() {
  try {
    const res = await fetch(`${RAG_URL}/memory/users/list`, { cache: 'no-store' })
    if (!res.ok) return NextResponse.json([], { status: res.status })
    return NextResponse.json(await res.json())
  } catch {
    return NextResponse.json([], { status: 503 })
  }
}

export async function POST(req: Request) {
  const session = await requireAdminApiSession()
  if (session instanceof NextResponse) {
    return session
  }

  try {
    const body = await req.json()
    const res = await fetch(`${RAG_URL}/memory/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: 'Failed to create memory profile' }, { status: 503 })
  }
}
