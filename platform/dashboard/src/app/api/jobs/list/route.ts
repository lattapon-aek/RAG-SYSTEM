import { NextResponse } from 'next/server'

const INGESTION_URL = process.env.INGESTION_SERVICE_URL ?? 'http://ingestion-service:8001'

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const search = url.searchParams.toString()
    const upstream = `${INGESTION_URL}/ingest/jobs${search ? `?${search}` : ''}`
    const res = await fetch(upstream, { cache: 'no-store' })
    const data = res.ok
      ? await res.json()
      : { items: [], total: 0, page: 1, page_size: 20, total_pages: 1 }
    return NextResponse.json(data, { status: res.ok ? 200 : res.status })
  } catch {
    return NextResponse.json({ items: [], total: 0, page: 1, page_size: 20, total_pages: 1 }, { status: 500 })
  }
}
