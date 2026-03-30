import { getServerSession } from 'next-auth'
import { NextResponse } from 'next/server'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'

export type DashboardRole = 'viewer' | 'operator' | 'admin'

const ROLE_RANK: Record<DashboardRole, number> = {
  viewer: 1,
  operator: 2,
  admin: 3,
}

function hasRole(role: string | undefined, requiredRole: DashboardRole) {
  if (!role) {
    return false
  }
  return (ROLE_RANK[role as DashboardRole] ?? 0) >= ROLE_RANK[requiredRole]
}

export async function requireSession(requiredRole: DashboardRole = 'viewer') {
  const session = await getServerSession(authOptions)

  if (!session?.user?.id || !hasRole(session.user.role, requiredRole)) {
    return null
  }

  return session
}

export async function requireApiSession(requiredRole: DashboardRole = 'viewer') {
  const session = await requireSession(requiredRole)

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return session
}

export async function requirePageSession(requiredRole: DashboardRole = 'viewer') {
  const session = await requireSession(requiredRole)

  if (!session) {
    redirect('/login')
  }

  return session
}

export async function requireAdminSession() {
  return requireSession('admin')
}

export async function requireAdminApiSession() {
  return requireApiSession('admin')
}

export async function requireAdminPageSession() {
  return requirePageSession('admin')
}

export async function requireOperatorApiSession() {
  return requireApiSession('operator')
}

export async function requireOperatorPageSession() {
  return requirePageSession('operator')
}

export async function requireViewerPageSession() {
  return requirePageSession('viewer')
}
