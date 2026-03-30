import { NextResponse } from 'next/server'

const RAG_URL = process.env.RAG_SERVICE_URL ?? 'http://rag-service:8000'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ namespace: string }> },
) {
  const { namespace } = await params
  try {
    const res = await fetch(
      `${RAG_URL}/namespaces/${encodeURIComponent(namespace)}`,
      { method: 'DELETE', cache: 'no-store' },
    )
    const data = res.ok ? await res.json() : { error: 'Delete failed' }
    return NextResponse.json(data, { status: res.ok ? 200 : 500 })
  } catch {
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
  }
}
