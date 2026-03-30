import { NextRequest, NextResponse } from 'next/server'
import { requireOperatorApiSession } from '@/lib/authz'
import { buildApprovalCandidatePayload, readResponseBody, type IngestSubmissionInput } from '@/lib/ingest-preview'

const INTELLIGENCE_SERVICE_URL =
  process.env.INTELLIGENCE_SERVICE_URL || 'http://localhost:8003'
const INGESTION_SERVICE_URL =
  process.env.INGESTION_SERVICE_URL || 'http://localhost:8001'

export async function POST(req: NextRequest) {
  const session = await requireOperatorApiSession()
  if (session instanceof NextResponse) {
    return session
  }

  try {
    const contentType = req.headers.get('content-type') ?? ''
    let body: IngestSubmissionInput
    let extractedText: string | undefined
    let extraMetadata: Record<string, unknown> = {}

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData()
      const source = String(formData.get('source') ?? 'file') === 'file' ? 'file' : 'text'
      const namespace = String(formData.get('namespace') ?? 'default')
      const url = String(formData.get('url') ?? '').trim()
      const filename = String(formData.get('filename') ?? '').trim() || undefined
      const mime_type = String(formData.get('mime_type') ?? '').trim() || undefined
      const text = String(formData.get('text') ?? '').trim() || undefined
      const file = formData.get('file')
      body = {
        source,
        namespace,
        url: url || undefined,
        filename,
        mime_type,
        text,
      }

      if (source === 'file' && file instanceof File) {
        const extractForm = new FormData()
        extractForm.append('file', file, file.name)
        const upstream = await fetch(`${INGESTION_SERVICE_URL}/ingest/extract`, {
          method: 'POST',
          body: extractForm,
          cache: 'no-store',
        })
        const extracted = await readResponseBody(upstream)
        if (!upstream.ok) {
          return NextResponse.json(
            { error: extracted?.detail?.error || extracted?.detail || extracted?.error || 'Failed to extract file text', upstream: extracted },
            { status: upstream.status }
          )
        }
        extractedText = String(extracted?.extracted_text ?? '').trim()
        extraMetadata = {
          extracted_char_count: extracted?.char_count ?? extractedText.length,
          extracted_filename: extracted?.filename ?? filename ?? null,
          extracted_mime_type: extracted?.mime_type ?? mime_type ?? null,
        }
      }
    } else {
      body = await req.json() as IngestSubmissionInput
      extractedText = body.text?.trim() || undefined
    }

    const payload = buildApprovalCandidatePayload(body, extractedText, extraMetadata)
    if (!String(payload.proposed_content ?? '').trim()) {
      return NextResponse.json({ error: 'Submission content is empty' }, { status: 400 })
    }
    const upstream = await fetch(`${INTELLIGENCE_SERVICE_URL}/self-learning/candidates`, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-user': session.user.name,
      },
      body: JSON.stringify(payload),
    })

    if (!upstream.ok) {
      const err = await readResponseBody(upstream)
      return NextResponse.json(
        { error: err?.detail || err?.error || 'Failed to create approval candidate', upstream: err },
        { status: upstream.status }
      )
    }

    const candidate = await readResponseBody(upstream)
    return NextResponse.json({
      candidate,
      submission: {
        source: body.source ?? 'text',
        filename: body.filename ?? null,
        namespace: body.namespace ?? 'default',
      },
    })
  } catch (err) {
    console.error('Failed to submit ingest for approval:', err)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
