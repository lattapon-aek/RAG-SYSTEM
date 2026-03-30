import { NextResponse } from 'next/server'

const RAG_URL = process.env.RAG_SERVICE_URL ?? 'http://rag-service:8000'
const INTEL_URL = process.env.INTELLIGENCE_SERVICE_URL ?? 'http://intelligence-service:8003'
const GRAPH_URL = process.env.GRAPH_SERVICE_URL ?? 'http://graph-service:8002'

export async function GET() {
  const [usersRes, metricsRes, evalRes, nsRes, graphNsRes] = await Promise.allSettled([
    fetch(`${RAG_URL}/memory/users/list`, { cache: 'no-store' }),
    fetch(`${RAG_URL}/metrics/summary`, { cache: 'no-store' }),
    fetch(`${INTEL_URL}/evaluation/summary`, { cache: 'no-store' }),
    fetch(`${RAG_URL}/namespaces`, { cache: 'no-store' }),
    fetch(`${GRAPH_URL}/graph/namespaces`, { cache: 'no-store' }),
  ])

  const users = usersRes.status === 'fulfilled' && usersRes.value.ok
    ? await usersRes.value.json().catch(() => [])
    : []

  const metrics = metricsRes.status === 'fulfilled' && metricsRes.value.ok
    ? await metricsRes.value.json().catch(() => null)
    : null

  const evalRaw = evalRes.status === 'fulfilled' && evalRes.value.ok
    ? await evalRes.value.json().catch(() => null)
    : null

  const evaluation = evalRaw ? {
    faithfulness: evalRaw.faithfulness ?? evalRaw.avg_faithfulness ?? null,
    answer_relevance: evalRaw.answer_relevance ?? evalRaw.avg_answer_relevance ?? null,
    context_precision: evalRaw.context_precision ?? evalRaw.avg_context_precision ?? null,
    context_recall: evalRaw.context_recall ?? evalRaw.avg_context_recall ?? null,
    sample_count: evalRaw.sample_count ?? evalRaw.total_evaluated ?? 0,
  } : null

  const vectorList: Array<{ namespace: string; document_count: number; chunk_count: number; description?: string }> =
    nsRes.status === 'fulfilled' && nsRes.value.ok
      ? await nsRes.value.json().catch(() => [])
      : []

  const graphList: Array<{ namespace: string; entity_count: number; relation_count: number }> =
    graphNsRes.status === 'fulfilled' && graphNsRes.value.ok
      ? await graphNsRes.value.json().catch(() => [])
      : []

  const graphMap = new Map(graphList.map((g) => [g.namespace, g]))
  const namespaces = vectorList.map((v) => {
    const g = graphMap.get(v.namespace)
    return {
      ...v,
      entity_count: g?.entity_count ?? 0,
      relation_count: g?.relation_count ?? 0,
      has_vector: true,
      has_graph: (g?.entity_count ?? 0) > 0,
    }
  })

  return NextResponse.json({ users, metrics, evaluation, namespaces })
}
