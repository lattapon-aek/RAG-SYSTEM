import { NextResponse } from 'next/server'
import { requireAdminApiSession } from '@/lib/authz'

const RAG_URL = process.env.RAG_SERVICE_URL ?? 'http://rag-service:8000'

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ user_id: string }> },
) {
  const session = await requireAdminApiSession()
  if (session instanceof NextResponse) {
    return session
  }

  const { user_id } = await params

  try {
    const res = await fetch(`${RAG_URL}/memory/users/${encodeURIComponent(user_id)}`, {
      method: 'DELETE',
    })
    const data = await res.json().catch(() => ({}))
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: 'Failed to delete memory profile' }, { status: 503 })
  }
}
