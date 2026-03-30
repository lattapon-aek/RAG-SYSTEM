import { withAuth } from 'next-auth/middleware'
import { NextResponse } from 'next/server'
import { API_ROLE_RULES, PAGE_ROLE_RULES, requiredRoleForPath } from '@/lib/route-access'

const ROLE_RANK = {
  viewer: 1,
  operator: 2,
  admin: 3,
} as const

export default withAuth(
  function proxy(req) {
    if (!req.nextauth.token) {
      const loginUrl = new URL('/login', req.url)
      loginUrl.searchParams.set('callbackUrl', req.url)
      return NextResponse.redirect(loginUrl)
    }

    const pathname = req.nextUrl.pathname
    const requiredRole = pathname.startsWith('/api/')
      ? requiredRoleForPath(pathname, API_ROLE_RULES)
      : requiredRoleForPath(pathname, PAGE_ROLE_RULES)

    if (requiredRole) {
      const actualRole = (req.nextauth.token.role as keyof typeof ROLE_RANK | undefined) ?? 'admin'
      if ((ROLE_RANK[actualRole] ?? 0) < ROLE_RANK[requiredRole]) {
        if (pathname.startsWith('/api/')) {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }
        return NextResponse.redirect(new URL('/dashboard', req.url))
      }
    }

    return NextResponse.next()
  },
  {
    callbacks: {
      authorized({ token }) {
        return !!token
      },
    },
  }
)

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/chat/:path*',
    '/documents/:path*',
    '/jobs/:path*',
    '/playground/:path*',
    '/knowledge-gaps/:path*',
    '/approvals/:path*',
    '/feedback/:path*',
    '/report/:path*',
    '/memory/:path*',
    '/cache/:path*',
    '/evaluation/:path*',
    '/audit-log/:path*',
    '/quota/:path*',
    '/api-keys/:path*',
    '/chat-identities/:path*',
    '/api/chat/:path*',
    '/api/chat-identities/:path*',
    '/api/documents/:path*',
    '/api/jobs/:path*',
    '/api/playground/:path*',
    '/api/knowledge-gaps/:path*',
    '/api/approvals/:path*',
    '/api/feedback/:path*',
    '/api/report/:path*',
    '/api/memory/:path*',
    '/api/cache/:path*',
    '/api/evaluation/:path*',
    '/api/admin-action-log/:path*',
    '/api/api-keys/:path*',
    '/api/rate-limit/:path*',
    '/api/quota/:path*',
    '/api/namespaces/:path*',
    '/api/self-learning/:path*',
  ],
}
