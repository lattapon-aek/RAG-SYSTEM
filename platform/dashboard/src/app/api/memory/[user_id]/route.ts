import { NextRequest } from 'next/server'

const RAG_URL = process.env.RAG_SERVICE_URL ?? 'http://rag-service:8000'

// GET /api/memory/[user_id]?backend=all|short|long
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ user_id: string }> }
) {
  const backend = req.nextUrl.searchParams.get('backend') ?? 'all'
  const { user_id } = await params
  const res = await fetch(
    `${RAG_URL}/memory/${encodeURIComponent(user_id)}?backend=${backend}`
  )
  const data = await res.json()
  // Normalise: unwrap {entries:[]} or return array directly
  const entries = Array.isArray(data) ? data : (data.entries ?? [])
  return Response.json(entries, { status: res.status })
}

// DELETE /api/memory/[user_id] → clear all (fetch list then delete each)
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ user_id: string }> }
) {
  const { user_id } = await params
  const listRes = await fetch(`${RAG_URL}/memory/${encodeURIComponent(user_id)}?backend=all`)
  if (!listRes.ok) return Response.json({ deleted: 0 })
  const data = await listRes.json()
  const entries: Array<{ id: string }> = Array.isArray(data) ? data : (data.entries ?? [])

  await Promise.all(
    entries.map((e) =>
      fetch(
        `${RAG_URL}/memory/${encodeURIComponent(user_id)}/${encodeURIComponent(e.id)}`,
        { method: 'DELETE' }
      )
    )
  )
  return Response.json({ deleted: entries.length })
}
