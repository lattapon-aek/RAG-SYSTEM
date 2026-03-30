import { NextResponse } from 'next/server'

const INGESTION_URL = process.env.INGESTION_SERVICE_URL ?? 'http://ingestion-service:8001'

export async function GET(_req: Request, { params }: { params: Promise<{ job_id: string }> }) {
  try {
    const { job_id } = await params
    const res = await fetch(`${INGESTION_URL}/ingest/jobs/${job_id}/preview`, { cache: 'no-store' })
    if (res.status === 404) return NextResponse.json(null, { status: 404 })
    const data = res.ok ? await res.json() : null
    return NextResponse.json(data, { status: res.ok ? 200 : res.status })
  } catch {
    return NextResponse.json(null, { status: 500 })
  }
}
