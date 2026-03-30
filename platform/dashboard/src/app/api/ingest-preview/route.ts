import { NextRequest, NextResponse } from 'next/server'
import { resolveIngestPreview, type IngestSubmissionInput } from '@/lib/ingest-preview'

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') ?? ''

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData()
      const file = formData.get('file')
      if (!(file instanceof File)) {
        return NextResponse.json({ error: 'file is required' }, { status: 400 })
      }
      const body: IngestSubmissionInput = {
        source: 'file',
        namespace: String(formData.get('namespace') ?? 'default'),
        filename: String(formData.get('filename') ?? file.name ?? 'upload'),
        url: String(formData.get('source_url') ?? '').trim() || undefined,
        mime_type: String(formData.get('mime_type') ?? file.type ?? 'application/octet-stream'),
        file,
      }
      const { status, data } = await resolveIngestPreview(body)
      return NextResponse.json(data, { status })
    }

    const body = await req.json() as IngestSubmissionInput
    const { status, data } = await resolveIngestPreview(body)
    return NextResponse.json(data, { status })
  } catch (err) {
    console.error('Preview request failed:', err)
    return NextResponse.json({ error: 'Ingestion service unavailable' }, { status: 503 })
  }
}
