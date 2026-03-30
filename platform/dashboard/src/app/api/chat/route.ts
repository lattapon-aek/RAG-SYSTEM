const RAG_SERVICE_URL = process.env.RAG_SERVICE_URL || 'http://rag-service:8000'

export async function POST(req: Request) {
  const body = await req.json()

  let upstream: Response
  try {
    upstream = await fetch(`${RAG_SERVICE_URL}/query/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    return Response.json({ error: 'rag-service unreachable' }, { status: 502 })
  }

  if (!upstream.ok) {
    const text = await upstream.text()
    return Response.json({ error: text }, { status: upstream.status })
  }

  return new Response(upstream.body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  })
}
