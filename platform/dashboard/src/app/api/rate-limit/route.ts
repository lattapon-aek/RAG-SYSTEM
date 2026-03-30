import { NextResponse } from 'next/server'
import { requireOperatorApiSession } from '@/lib/authz'

const RAG_URL = process.env.RAG_SERVICE_URL ?? 'http://rag-service:8000'

export async function GET() {
  const session = await requireOperatorApiSession()
  if (session instanceof NextResponse) {
    return session
  }

  try {
    const res = await fetch(`${RAG_URL}/rate-limit/stats`, { cache: 'no-store' })
    const data = res.ok ? await res.json() : { active_clients: 0, default_rpm: 60, top_clients: [] }
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ active_clients: 0, default_rpm: 60, top_clients: [] })
  }
}
