import { NextResponse } from 'next/server'
import { requireSession } from '@/lib/authz'
import { getDashboardPgPool } from '@/lib/db'
import { recordDashboardAdminAction } from '@/lib/admin-audit'

function toIso(value: unknown) {
  if (!value) return null
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString()
}

function mapRow(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    name: String(row.name),
    description: typeof row.description === 'string' ? row.description : null,
    namespace: String(row.namespace ?? 'default'),
    client_id: String(row.client_id),
    user_id: String(row.user_id),
    created_by: typeof row.created_by === 'string' ? row.created_by : null,
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
    revoked_at: toIso(row.revoked_at),
  }
}

export async function GET(req: Request) {
  const session = await requireSession('viewer')
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const url = new URL(req.url)
    const includeRevoked = url.searchParams.get('include_revoked') === 'true' || url.searchParams.get('include_revoked') === '1'
    const isAdmin = session.user.role === 'admin'

    if (includeRevoked && !isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const pool = getDashboardPgPool()
    const result = await pool.query(
      `SELECT id, name, description, namespace, client_id, user_id, created_by, created_at, updated_at, revoked_at
       FROM chat_identities
       WHERE ($1::boolean = true OR revoked_at IS NULL)
       ORDER BY name ASC`,
      [includeRevoked && isAdmin],
    )

    return NextResponse.json(result.rows.map(mapRow))
  } catch (error) {
    console.error('Failed to list chat identities:', error)
    return NextResponse.json({ error: 'Failed to list chat identities' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const session = await requireSession('admin')
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    const description = typeof body?.description === 'string' ? body.description.trim() : ''
    const namespace = typeof body?.namespace === 'string' ? body.namespace.trim() : 'default'
    const clientId = typeof body?.client_id === 'string' ? body.client_id.trim() : ''
    const userId = typeof body?.user_id === 'string' ? body.user_id.trim() : ''

    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }
    if (!namespace) {
      return NextResponse.json({ error: 'Namespace is required' }, { status: 400 })
    }
    if (!clientId) {
      return NextResponse.json({ error: 'Client ID is required' }, { status: 400 })
    }
    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 })
    }

    const pool = getDashboardPgPool()
    const result = await pool.query(
      `INSERT INTO chat_identities (name, description, namespace, client_id, user_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, description, namespace, client_id, user_id, created_by, created_at, updated_at, revoked_at`,
      [name, description || null, namespace || 'default', clientId, userId, session.user.name ?? session.user.id],
    )

    const record = mapRow(result.rows[0])
    await recordDashboardAdminAction({
      adminUserId: session.user.name ?? session.user.id,
      action: 'create_chat_identity',
      resourceType: 'chat_identity',
      targetId: record.id,
      afterValue: record,
      notes: `Created chat identity ${record.name}`,
    })

    return NextResponse.json(record, { status: 201 })
  } catch (error: unknown) {
    const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : null
    if (code === '23505') {
      return NextResponse.json({ error: 'Chat identity name already exists' }, { status: 409 })
    }
    console.error('Failed to create chat identity:', error)
    return NextResponse.json({ error: 'Failed to create chat identity' }, { status: 500 })
  }
}
