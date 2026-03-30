import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { requireAdminApiSession } from '@/lib/authz'
import { getDashboardPgPool } from '@/lib/db'
import { recordDashboardAdminAction } from '@/lib/admin-audit'

export async function GET() {
  const session = await requireAdminApiSession()
  if (session instanceof NextResponse) {
    return session
  }

  try {
    const pool = getDashboardPgPool()
    const result = await pool.query(
      `SELECT id, username, role, created_at
       FROM admin_users
       ORDER BY username ASC`
    )

    return NextResponse.json(
      result.rows.map((row) => ({
        id: String(row.id),
        username: row.username,
        role: row.role ?? 'admin',
        created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
      })),
    )
  } catch (error) {
    console.error('Failed to list admin users:', error)
    return NextResponse.json({ error: 'Failed to list admin users' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const session = await requireAdminApiSession()
  if (session instanceof NextResponse) {
    return session
  }

  try {
    const body = await req.json()
    const username = typeof body?.username === 'string' ? body.username.trim() : ''
    const password = typeof body?.password === 'string' ? body.password : ''
    const role = typeof body?.role === 'string' ? body.role : 'viewer'

    if (!username) {
      return NextResponse.json({ error: 'Username is required' }, { status: 400 })
    }
    if (password.length < 10) {
      return NextResponse.json({ error: 'Password must be at least 10 characters' }, { status: 400 })
    }
    if (!['viewer', 'operator', 'admin'].includes(role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
    }

    const hashedPassword = await bcrypt.hash(password, 10)
    const pool = getDashboardPgPool()
    const result = await pool.query(
      `INSERT INTO admin_users (username, hashed_password, role)
       VALUES ($1, $2, $3)
       RETURNING id, username, role, created_at`,
      [username, hashedPassword, role],
    )

    const row = result.rows[0]
    const response = {
      id: String(row.id),
      username: row.username,
      role: row.role ?? 'admin',
      created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
    }

    await recordDashboardAdminAction({
      adminUserId: session.user.name ?? session.user.id,
      action: 'create_admin_user',
      resourceType: 'admin_user',
      targetId: response.id,
      afterValue: { username: response.username, role: response.role },
      notes: `Created dashboard admin user ${response.username}`,
    })

    return NextResponse.json(response, { status: 201 })
  } catch (error: unknown) {
    const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : null
    if (code === '23505') {
      return NextResponse.json({ error: 'Username already exists' }, { status: 409 })
    }
    console.error('Failed to create admin user:', error)
    return NextResponse.json({ error: 'Failed to create admin user' }, { status: 500 })
  }
}
