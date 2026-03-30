import { NextRequest } from 'next/server'

const RAG_URL = process.env.RAG_SERVICE_URL ?? 'http://rag-service:8000'

// DELETE /api/memory/[user_id]/[memory_id]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ user_id: string; memory_id: string }> }
) {
  const { user_id, memory_id } = await params
  const res = await fetch(
    `${RAG_URL}/memory/${encodeURIComponent(user_id)}/${encodeURIComponent(memory_id)}`,
    { method: 'DELETE' }
  )
  return new Response(null, { status: res.ok ? 204 : res.status })
}
