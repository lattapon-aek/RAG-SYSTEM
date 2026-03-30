import crypto from 'node:crypto'
import { NextResponse } from 'next/server'
import { requireAdminApiSession } from '@/lib/authz'
import { getDashboardPgPool } from '@/lib/db'
import { recordDashboardAdminAction } from '@/lib/admin-audit'

function mapRow(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    client_id: String(row.client_id),
    label: typeof row.label === 'string' ? row.label : null,
    key_prefix: typeof row.key_prefix === 'string' ? row.key_prefix : null,
    created_by: typeof row.created_by === 'string' ? row.created_by : null,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at ? new Date(String(row.created_at)).toISOString() : null,
    last_used_at: row.last_used_at instanceof Date ? row.last_used_at.toISOString() : row.last_used_at ? new Date(String(row.last_used_at)).toISOString() : null,
    revoked_at: row.revoked_at instanceof Date ? row.revoked_at.toISOString() : row.revoked_at ? new Date(String(row.revoked_at)).toISOString() : null,
  }
}

function makePlaintextKey() {
  return `rag_${crypto.randomBytes(24).toString('hex')}`
}

function hashKey(plaintext: string) {
  return crypto.createHash('sha256').update(plaintext).digest('hex')
}

export async function GET() {
  const session = await requireAdminApiSession()
  if (session instanceof NextResponse) {
    return session
  }

  try {
    const pool = getDashboardPgPool()
    const result = await pool.query(
      `SELECT id, client_id, label, key_prefix, created_by, created_at, last_used_at, revoked_at
       FROM api_keys
       ORDER BY created_at DESC`,
    )
    return NextResponse.json(result.rows.map(mapRow))
  } catch (error) {
    console.error('Failed to list API keys:', error)
    return NextResponse.json({ error: 'Failed to list API keys' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const session = await requireAdminApiSession()
  if (session instanceof NextResponse) {
    return session
  }

  let clientId = ''
  try {
    const body = await req.json()
    clientId = typeof body?.client_id === 'string' ? body.client_id.trim() : ''
    const label = typeof body?.label === 'string' ? body.label.trim() : ''

    if (!clientId) {
      return NextResponse.json({ error: 'Client ID is required' }, { status: 400 })
    }

    const createdBy = session.user.name ?? session.user.id
    const pool = getDashboardPgPool()
    const activeExisting = await pool.query(
      `SELECT id
       FROM api_keys
       WHERE client_id = $1
         AND revoked_at IS NULL
       LIMIT 1`,
      [clientId],
    )
    if ((activeExisting.rowCount ?? 0) > 0) {
      return NextResponse.json(
        { error: `Client ID ${clientId} already has an active API key` },
        { status: 409 },
      )
    }
    const plaintextKey = makePlaintextKey()
    const hashedKey = hashKey(plaintextKey)
    const keyPrefix = plaintextKey.slice(0, 16)
    const result = await pool.query(
      `INSERT INTO api_keys (client_id, hashed_key, label, key_prefix, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, client_id, label, key_prefix, created_by, created_at, last_used_at, revoked_at`,
      [clientId, hashedKey, label || null, keyPrefix, createdBy],
    )
    const record = mapRow(result.rows[0])

    await recordDashboardAdminAction({
      adminUserId: createdBy,
      action: 'create_api_key',
      resourceType: 'api_key',
      targetId: record.id,
      afterValue: {
        client_id: record.client_id,
        label: record.label,
        key_prefix: record.key_prefix,
      },
      notes: `Created API key for ${record.client_id}`,
    })

    return NextResponse.json(
      {
        record,
        plaintext_key: plaintextKey,
      },
      { status: 201 },
    )
  } catch (error) {
    if (typeof error === 'object' && error && 'code' in error && (error as { code?: string }).code === '23505') {
      const constraint = typeof error === 'object' && error && 'constraint' in error
        ? String((error as { constraint?: unknown }).constraint || '')
        : ''
      if (constraint === 'uq_api_keys_active_client') {
        return NextResponse.json(
          { error: `Client ID ${clientId} already has an active API key` },
          { status: 409 },
        )
      }
      if (constraint === 'uq_api_keys_active_hash') {
        return NextResponse.json(
          { error: 'This API key value is already active for another client' },
          { status: 409 },
        )
      }
      return NextResponse.json(
        { error: 'API key conflict detected' },
        { status: 409 },
      )
    }
    console.error('Failed to create API key:', error)
    return NextResponse.json({ error: 'Failed to create API key' }, { status: 500 })
  }
}
