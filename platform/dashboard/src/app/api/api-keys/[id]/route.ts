import { NextResponse } from 'next/server'
import { requireAdminApiSession } from '@/lib/authz'
import { getDashboardPgPool } from '@/lib/db'
import { recordDashboardAdminAction } from '@/lib/admin-audit'

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdminApiSession()
  if (session instanceof NextResponse) {
    return session
  }

  try {
    const { id } = await params
    const pool = getDashboardPgPool()
    const current = await pool.query(
      `SELECT id, client_id, label, key_prefix, revoked_at
       FROM api_keys
       WHERE id = $1`,
      [id],
    )
    if (current.rowCount === 0) {
      return NextResponse.json({ error: 'API key not found' }, { status: 404 })
    }
    const existing = current.rows[0]

    if (existing.revoked_at) {
      return NextResponse.json({ revoked_at: new Date(existing.revoked_at).toISOString() })
    }

    const result = await pool.query(
      `UPDATE api_keys
       SET revoked_at = NOW()
       WHERE id = $1
       RETURNING revoked_at`,
      [id],
    )

    await recordDashboardAdminAction({
      adminUserId: session.user.name ?? session.user.id,
      action: 'revoke_api_key',
      resourceType: 'api_key',
      targetId: id,
      beforeValue: {
        client_id: existing.client_id,
        label: existing.label,
        key_prefix: existing.key_prefix,
      },
      afterValue: {
        revoked_at: result.rows[0].revoked_at ? new Date(result.rows[0].revoked_at).toISOString() : null,
      },
      notes: `Revoked API key for ${existing.client_id}`,
    })

    return NextResponse.json({
      revoked_at: result.rows[0].revoked_at ? new Date(result.rows[0].revoked_at).toISOString() : null,
    })
  } catch (error) {
    console.error('Failed to revoke API key:', error)
    return NextResponse.json({ error: 'Failed to revoke API key' }, { status: 500 })
  }
}
