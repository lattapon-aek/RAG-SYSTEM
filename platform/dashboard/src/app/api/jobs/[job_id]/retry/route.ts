import { NextResponse } from 'next/server'

const INGESTION_URL = process.env.INGESTION_SERVICE_URL ?? 'http://ingestion-service:8001'

export async function POST(_req: Request, { params }: { params: Promise<{ job_id: string }> }) {
  try {
    const { job_id } = await params
    const res = await fetch(`${INGESTION_URL}/ingest/${job_id}/retry`, {
      method: 'POST',
      cache: 'no-store',
    })
    const data = res.ok ? await res.json() : { error: `HTTP ${res.status}` }
    return NextResponse.json(data, { status: res.ok ? 200 : res.status })
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
