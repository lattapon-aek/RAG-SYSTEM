import { NextRequest, NextResponse } from 'next/server'

const RAG_URL = process.env.RAG_SERVICE_URL ?? 'http://rag-service:8000'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const res = await fetch(`${RAG_URL}/retrieve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      return NextResponse.json(
        { error: err?.detail || `HTTP ${res.status}` },
        { status: res.status }
      )
    }
    return NextResponse.json(await res.json())
  } catch {
    return NextResponse.json({ error: 'RAG service unavailable' }, { status: 503 })
  }
}
