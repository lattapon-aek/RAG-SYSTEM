import { NextResponse } from 'next/server'
import { requireOperatorApiSession } from '@/lib/authz'

const RAG_URL = process.env.RAG_SERVICE_URL ?? 'http://rag-service:8000'

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireOperatorApiSession()
  if (session instanceof NextResponse) {
    return session
  }

  const { searchParams } = new URL(req.url)
  const namespace = searchParams.get('namespace') ?? 'default'
  try {
    const { id } = await params
    const res = await fetch(`${RAG_URL}/documents/${id}?namespace=${encodeURIComponent(namespace)}`, {
      method: 'DELETE',
      cache: 'no-store',
      headers: { 'x-admin-user': session.user.name },
    })
    const data = res.ok ? await res.json() : { error: `HTTP ${res.status}` }
    return NextResponse.json(data, { status: res.ok ? 200 : res.status })
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
