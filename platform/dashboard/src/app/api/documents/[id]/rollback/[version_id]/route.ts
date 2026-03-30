import { NextResponse } from 'next/server'

const INGESTION_URL = process.env.INGESTION_SERVICE_URL ?? 'http://ingestion-service:8001'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; version_id: string }> },
) {
  const { searchParams } = new URL(req.url)
  const namespace = searchParams.get('namespace')
  try {
    const { id, version_id } = await params
    const qs = namespace ? `?namespace=${encodeURIComponent(namespace)}` : ''
    const res = await fetch(
      `${INGESTION_URL}/documents/${id}/rollback/${version_id}${qs}`,
      { method: 'POST', cache: 'no-store' },
    )
    const data = res.ok ? await res.json() : { error: `HTTP ${res.status}` }
    return NextResponse.json(data, { status: res.ok ? 200 : res.status })
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
