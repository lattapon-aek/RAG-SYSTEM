import { NextResponse } from 'next/server'

const RAG_URL = process.env.RAG_SERVICE_URL ?? 'http://rag-service:8000'

export async function GET() {
  try {
    const res = await fetch(`${RAG_URL}/memory/users/list`, { cache: 'no-store' })
    if (!res.ok) return NextResponse.json([], { status: res.status })
    return NextResponse.json(await res.json())
  } catch {
    return NextResponse.json([], { status: 503 })
  }
}
