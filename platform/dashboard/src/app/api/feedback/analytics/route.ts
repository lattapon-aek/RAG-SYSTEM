import { NextRequest } from 'next/server'

const INTELLIGENCE_URL = process.env.INTELLIGENCE_SERVICE_URL ?? 'http://intelligence-service:8003'

export async function GET(req: NextRequest) {
  const days = req.nextUrl.searchParams.get('days') ?? '14'
  const res = await fetch(`${INTELLIGENCE_URL}/feedback/analytics?days=${days}`, {
    cache: 'no-store',
  })
  const data = await res.json()
  return Response.json(data, { status: res.status })
}
