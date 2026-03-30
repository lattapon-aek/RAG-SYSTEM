import { NextResponse } from 'next/server'

const INTEL_URL = process.env.INTELLIGENCE_SERVICE_URL ?? 'http://intelligence-service:8003'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const limit = searchParams.get('limit') ?? '50'
  try {
    const res = await fetch(`${INTEL_URL}/evaluation/history?limit=${limit}`, { cache: 'no-store' })
    const data = res.ok ? await res.json() : []
    return NextResponse.json(data)
  } catch {
    return NextResponse.json([])
  }
}
