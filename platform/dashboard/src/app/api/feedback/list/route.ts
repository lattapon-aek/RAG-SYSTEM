import { NextRequest } from 'next/server'

const INTELLIGENCE_URL = process.env.INTELLIGENCE_SERVICE_URL ?? 'http://intelligence-service:8003'

export async function GET(req: NextRequest) {
  const limit = req.nextUrl.searchParams.get('limit') ?? '100'
  const res = await fetch(`${INTELLIGENCE_URL}/feedback/list?limit=${limit}`)
  if (!res.ok) return Response.json([], { status: 200 })
  const data = await res.json()
  return Response.json(data)
}
