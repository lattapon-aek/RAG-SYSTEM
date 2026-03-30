import { NextResponse } from 'next/server'

const RAG_URL = process.env.RAG_SERVICE_URL ?? 'http://rag-service:8000'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const namespace = searchParams.get('namespace') ?? 'default'
  try {
    const res = await fetch(`${RAG_URL}/documents?namespace=${namespace}`, { cache: 'no-store' })
    const data = res.ok ? await res.json() : []
    return NextResponse.json(data)
  } catch {
    return NextResponse.json([])
  }
}
