import { NextResponse } from 'next/server'

const GRAPH_URL = process.env.GRAPH_SERVICE_URL ?? 'http://graph-service:8002'

export async function GET() {
  try {
    const res = await fetch(`${GRAPH_URL}/graph/stats`, { cache: 'no-store' })
    if (!res.ok) return NextResponse.json({ entity_count: 0, relation_count: 0 })
    return NextResponse.json(await res.json())
  } catch {
    return NextResponse.json({ entity_count: 0, relation_count: 0, error: 'unavailable' })
  }
}
