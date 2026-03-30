import { NextRequest } from 'next/server'

const RAG_URL = process.env.RAG_SERVICE_URL ?? 'http://rag-service:8000'

// POST /api/memory  → save a memory entry
export async function POST(req: NextRequest) {
  const body = await req.json()
  const res = await fetch(`${RAG_URL}/memory/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  return Response.json(data, { status: res.status })
}
