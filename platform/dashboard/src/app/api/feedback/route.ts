import { NextRequest } from 'next/server'

const INTELLIGENCE_URL = process.env.INTELLIGENCE_SERVICE_URL ?? 'http://intelligence-service:8003'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const res = await fetch(`${INTELLIGENCE_URL}/feedback/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  return Response.json(data, { status: res.status })
}

export async function GET() {
  const res = await fetch(`${INTELLIGENCE_URL}/feedback/stats`)
  const data = await res.json()
  return Response.json(data, { status: res.status })
}
