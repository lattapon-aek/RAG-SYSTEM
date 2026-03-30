import { NextRequest, NextResponse } from 'next/server'

const GRAPH_URL = process.env.GRAPH_SERVICE_URL ?? 'http://graph-service:8002'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const res = await fetch(`${GRAPH_URL}/graph/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
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
    return NextResponse.json({ error: 'Graph service unavailable' }, { status: 503 })
  }
}
