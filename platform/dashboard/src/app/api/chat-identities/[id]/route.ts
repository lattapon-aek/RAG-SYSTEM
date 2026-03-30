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

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession('admin')
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const body = await req.json()
    const name = typeof body?.name === 'string' ? body.name.trim() : null
    const description = typeof body?.description === 'string' ? body.description.trim() : null
    const namespace = typeof body?.namespace === 'string' ? body.namespace.trim() : null
    const clientId = typeof body?.client_id === 'string' ? body.client_id.trim() : null
    const userId = typeof body?.user_id === 'string' ? body.user_id.trim() : null

    if (!name && !description && !namespace && !clientId && !userId) {
      return NextResponse.json({ error: 'No changes requested' }, { status: 400 })
    }

    const pool = getDashboardPgPool()
    const current = await pool.query(
      `SELECT id, name, description, namespace, client_id, user_id, created_by, created_at, updated_at, revoked_at
       FROM chat_identities
       WHERE id = $1`,
      [id],
    )

    if (current.rowCount === 0) {
      return NextResponse.json({ error: 'Chat identity not found' }, { status: 404 })
    }

    const existing = mapRow(current.rows[0])
    const next = {
      name: name ?? existing.name,
      description: description ?? existing.description,
      namespace: namespace ?? existing.namespace,
      client_id: clientId ?? existing.client_id,
      user_id: userId ?? existing.user_id,
    }

    const result = await pool.query(
      `UPDATE chat_identities
       SET name = $1,
           description = $2,
           namespace = $3,
           client_id = $4,
           user_id = $5,
           updated_at = NOW()
       WHERE id = $6
       RETURNING id, name, description, namespace, client_id, user_id, created_by, created_at, updated_at, revoked_at`,
      [next.name, next.description, next.namespace, next.client_id, next.user_id, id],
    )

    const record = mapRow(result.rows[0])
    await recordDashboardAdminAction({
      adminUserId: session.user.name ?? session.user.id,
      action: 'update_chat_identity',
      resourceType: 'chat_identity',
      targetId: record.id,
      beforeValue: existing,
      afterValue: record,
      notes: `Updated chat identity ${record.name}`,
    })

    return NextResponse.json(record)
  } catch (error: unknown) {
    const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : null
    if (code === '23505') {
      return NextResponse.json({ error: 'Chat identity name already exists' }, { status: 409 })
    }
    console.error('Failed to update chat identity:', error)
    return NextResponse.json({ error: 'Failed to update chat identity' }, { status: 500 })
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession('admin')
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const pool = getDashboardPgPool()
    const current = await pool.query(
      `SELECT id, name, description, namespace, client_id, user_id, created_by, created_at, updated_at, revoked_at
       FROM chat_identities
       WHERE id = $1`,
      [id],
    )

    if (current.rowCount === 0) {
      return NextResponse.json({ error: 'Chat identity not found' }, { status: 404 })
    }

    const existing = mapRow(current.rows[0])
    if (existing.revoked_at) {
      return NextResponse.json({ revoked_at: existing.revoked_at })
    }

    const result = await pool.query(
      `UPDATE chat_identities
       SET revoked_at = NOW(),
           updated_at = NOW()
       WHERE id = $1
       RETURNING revoked_at`,
      [id],
    )

    await recordDashboardAdminAction({
      adminUserId: session.user.name ?? session.user.id,
      action: 'revoke_chat_identity',
      resourceType: 'chat_identity',
      targetId: id,
      beforeValue: existing,
      afterValue: { revoked_at: result.rows[0].revoked_at ? new Date(result.rows[0].revoked_at).toISOString() : null },
      notes: `Revoked chat identity ${existing.name}`,
    })

    return NextResponse.json({
      revoked_at: result.rows[0].revoked_at ? new Date(result.rows[0].revoked_at).toISOString() : null,
    })
  } catch (error) {
    console.error('Failed to revoke chat identity:', error)
    return NextResponse.json({ error: 'Failed to revoke chat identity' }, { status: 500 })
  }
}
