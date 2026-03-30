import type { DashboardRole } from '@/lib/authz'

export const PAGE_ROLE_RULES: Array<[string, DashboardRole]> = [
  ['/dashboard', 'viewer'],
  ['/chat', 'viewer'],
  ['/report', 'viewer'],
  ['/feedback', 'viewer'],
  ['/evaluation', 'viewer'],
  ['/documents', 'operator'],
  ['/jobs', 'operator'],
  ['/playground', 'operator'],
  ['/memory', 'operator'],
  ['/cache', 'operator'],
  ['/quota', 'operator'],
  ['/knowledge-gaps', 'admin'],
  ['/approvals', 'admin'],
  ['/audit-log', 'admin'],
  ['/admin-users', 'admin'],
  ['/api-keys', 'admin'],
  ['/chat-identities', 'admin'],
]

export const API_ROLE_RULES: Array<[string, DashboardRole]> = [
  ['/api/quota', 'operator'],
  ['/api/rate-limit', 'operator'],
  ['/api/cache', 'operator'],
  ['/api/documents', 'operator'],
  ['/api/jobs', 'operator'],
  ['/api/playground', 'operator'],
  ['/api/memory', 'operator'],
  ['/api/admin-action-log', 'operator'],
  ['/api/admin-users', 'admin'],
  ['/api/api-keys', 'admin'],
  ['/api/chat-identities', 'viewer'],
  ['/api/knowledge-gaps', 'admin'],
  ['/api/approvals', 'admin'],
  ['/api/self-learning', 'admin'],
]

export function requiredRoleForPath(
  pathname: string,
  rules: Array<[string, DashboardRole]>,
): DashboardRole | null {
  for (const [prefix, role] of rules) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      return role
    }
  }
  return null
}
