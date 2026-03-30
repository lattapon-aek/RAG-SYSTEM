import { NextRequest, NextResponse } from 'next/server'

const INGESTION_URL = process.env.INGESTION_SERVICE_URL ?? 'http://ingestion-service:8001'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const namespace = req.nextUrl.searchParams.get('namespace') ?? 'default'
  try {
    const res = await fetch(
      `${INGESTION_URL}/documents/${id}/chunks?namespace=${namespace}`,
      { cache: 'no-store' }
    )
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      return NextResponse.json(
        { error: err?.detail || `HTTP ${res.status}` },
        { status: res.status }
      )
    }
    return NextResponse.json(await res.json())
  } catch {
    return NextResponse.json({ error: 'Ingestion service unavailable' }, { status: 503 })
  }
}
