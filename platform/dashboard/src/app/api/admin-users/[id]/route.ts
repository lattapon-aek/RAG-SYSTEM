import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { requireAdminApiSession } from '@/lib/authz'
import { getDashboardPgPool } from '@/lib/db'
import { recordDashboardAdminAction } from '@/lib/admin-audit'

const ALLOWED_ROLES = new Set(['viewer', 'operator', 'admin'])

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdminApiSession()
  if (session instanceof NextResponse) {
    return session
  }

  try {
    const { id } = await params
    const body = await req.json()
    const role = typeof body?.role === 'string' ? body.role : null
    const password = typeof body?.password === 'string' ? body.password : null

    if (!role && !password) {
      return NextResponse.json({ error: 'No changes requested' }, { status: 400 })
    }
    if (role && !ALLOWED_ROLES.has(role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
    }
    if (password && password.length < 10) {
      return NextResponse.json({ error: 'Password must be at least 10 characters' }, { status: 400 })
    }

    const pool = getDashboardPgPool()
    const current = await pool.query(
      `SELECT id, username, role, created_at
       FROM admin_users
       WHERE id = $1`,
      [id],
    )

    if (current.rowCount === 0) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const existing = current.rows[0]
    const nextRole = role ?? existing.role ?? 'admin'
    const hashedPassword = password ? await bcrypt.hash(password, 10) : null

    const result = await pool.query(
      `UPDATE admin_users
       SET role = $1,
           hashed_password = COALESCE($2, hashed_password)
       WHERE id = $3
       RETURNING id, username, role, created_at`,
      [nextRole, hashedPassword, id],
    )

    const row = result.rows[0]
    const response = {
      id: String(row.id),
      username: row.username,
      role: row.role,
      created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
    }

    if (role && role !== existing.role) {
      await recordDashboardAdminAction({
        adminUserId: session.user.name ?? session.user.id,
        action: 'update_admin_user_role',
        resourceType: 'admin_user',
        targetId: response.id,
        beforeValue: { username: existing.username, role: existing.role ?? 'admin' },
        afterValue: { username: response.username, role: response.role },
        notes: `Updated dashboard role for ${response.username}`,
      })
    }

    if (password) {
      await recordDashboardAdminAction({
        adminUserId: session.user.name ?? session.user.id,
        action: 'reset_admin_user_password',
        resourceType: 'admin_user',
        targetId: response.id,
        beforeValue: { username: existing.username },
        afterValue: { username: response.username },
        notes: `Reset dashboard password for ${response.username}`,
      })
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('Failed to update admin user role:', error)
    return NextResponse.json({ error: 'Failed to update admin user' }, { status: 500 })
  }
}
