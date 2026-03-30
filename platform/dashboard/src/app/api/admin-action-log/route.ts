import { NextResponse } from 'next/server'
import { requireOperatorApiSession } from '@/lib/authz'

const RAG_URL = process.env.RAG_SERVICE_URL ?? 'http://rag-service:8000'

export async function GET(req: Request) {
  const session = await requireOperatorApiSession()
  if (session instanceof NextResponse) {
    return session
  }

  try {
    const url = new URL(req.url)
    const upstream = new URL(`${RAG_URL}/admin/action-log`)
    url.searchParams.forEach((value, key) => upstream.searchParams.set(key, value))

    const res = await fetch(upstream.toString(), { cache: 'no-store' })
    const data = await res.json().catch(() => [])
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json([], { status: 500 })
  }
}
