import { NextResponse } from 'next/server'

const INGESTION_URL = process.env.INGESTION_SERVICE_URL ?? 'http://ingestion-service:8001'

export async function GET() {
  try {
    const res = await fetch(`${INGESTION_URL}/ingest/queue/stats`, { cache: 'no-store' })
    const data = res.ok ? await res.json() : { queue_depth: 0, processing: 0, failed_total: 0, recent_failures: [] }
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ queue_depth: 0, processing: 0, failed_total: 0, recent_failures: [] })
  }
}
