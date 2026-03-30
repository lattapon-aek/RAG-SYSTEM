import { NextResponse } from 'next/server'
import { requireOperatorApiSession } from '@/lib/authz'

const RAG_URL = process.env.RAG_SERVICE_URL ?? 'http://rag-service:8000'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const namespace = searchParams.get('namespace')
  try {
    const qs = namespace ? `?namespace=${encodeURIComponent(namespace)}` : ''
    const res = await fetch(`${RAG_URL}/cache/entries${qs}`, { cache: 'no-store' })
    const data = res.ok ? await res.json() : []
    return NextResponse.json(data)
  } catch {
    return NextResponse.json([])
  }
}

export async function DELETE() {
  const session = await requireOperatorApiSession()
  if (session instanceof NextResponse) {
    return session
  }

  try {
    const res = await fetch(`${RAG_URL}/cache`, {
      method: 'DELETE',
      cache: 'no-store',
      headers: { 'x-admin-user': session.user.name },
    })
    const data = res.ok ? await res.json() : { deleted: 0 }
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ deleted: 0 })
  }
}
