import { NextResponse } from 'next/server'

const RAG_URL = process.env.RAG_SERVICE_URL ?? 'http://rag-service:8000'

export async function GET() {
  try {
    const res = await fetch(`${RAG_URL}/memory/stats`, { cache: 'no-store' })
    if (!res.ok) return NextResponse.json({ short_term_users: 0, short_term_entries: 0, long_term_users: 0, long_term_entries: 0 })
    return NextResponse.json(await res.json())
  } catch {
    return NextResponse.json({ short_term_users: 0, short_term_entries: 0, long_term_users: 0, long_term_entries: 0 })
  }
}
