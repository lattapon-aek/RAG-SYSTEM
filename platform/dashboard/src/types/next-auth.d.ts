import { DefaultSession } from 'next-auth'
import { JWT } from 'next-auth/jwt'
import type { DashboardRole } from '@/lib/authz'

declare module 'next-auth' {
  interface Session {
    user: DefaultSession['user'] & {
      id: string
      name: string
      role: DashboardRole
    }
  }

  interface User {
    id: string
    name: string
    role: DashboardRole
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id?: string
    name?: string
    role?: DashboardRole
  }
}
