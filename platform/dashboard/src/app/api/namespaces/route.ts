import { NextResponse } from 'next/server'

const RAG_URL = process.env.RAG_SERVICE_URL ?? 'http://rag-service:8000'
const GRAPH_URL = process.env.GRAPH_SERVICE_URL ?? 'http://graph-service:8002'

export async function GET() {
  try {
    const [vectorRes, graphRes] = await Promise.allSettled([
      fetch(`${RAG_URL}/namespaces`, { cache: 'no-store' }),
      fetch(`${GRAPH_URL}/graph/namespaces`, { cache: 'no-store' }),
    ])

    const vectorList: Array<{ namespace: string; document_count: number; chunk_count: number; description?: string }> =
      vectorRes.status === 'fulfilled' && vectorRes.value.ok
        ? await vectorRes.value.json().catch(() => [])
        : []

    const graphList: Array<{ namespace: string; entity_count: number; relation_count: number }> =
      graphRes.status === 'fulfilled' && graphRes.value.ok
        ? await graphRes.value.json().catch(() => [])
        : []

    const graphMap = new Map(graphList.map((g) => [g.namespace, g]))

    // Merge: vector namespaces as base, attach graph stats
    const merged = vectorList.map((v) => {
      const g = graphMap.get(v.namespace)
      graphMap.delete(v.namespace)
      return {
        ...v,
        entity_count: g?.entity_count ?? 0,
        relation_count: g?.relation_count ?? 0,
        has_vector: true,
        has_graph: (g?.entity_count ?? 0) > 0,
      }
    })

    // Graph-only namespaces (no vector docs — rare but possible)
    for (const g of Array.from(graphMap.values())) {
      merged.push({
        namespace: g.namespace,
        document_count: 0,
        chunk_count: 0,
        description: undefined,
        entity_count: g.entity_count,
        relation_count: g.relation_count,
        has_vector: false,
        has_graph: true,
      })
    }

    return NextResponse.json(merged)
  } catch {
    return NextResponse.json([])
  }
}

export async function PUT(request: Request) {
  try {
    const { namespace, description } = await request.json()
    const res = await fetch(`${RAG_URL}/namespaces/${encodeURIComponent(namespace)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: description ?? null }),
      cache: 'no-store',
    })
    const data = res.ok ? await res.json() : { error: 'Update failed' }
    return NextResponse.json(data, { status: res.ok ? 200 : 500 })
  } catch {
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }
}
