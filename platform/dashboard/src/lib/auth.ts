import type { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import type { PoolClient } from 'pg'
import type { DashboardRole } from '@/lib/authz'
import { getDashboardPgPool } from '@/lib/db'

const pool = getDashboardPgPool()
const bootstrapAdminUsername = process.env.BOOTSTRAP_ADMIN_USERNAME?.trim()
const bootstrapAdminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD

async function ensureBootstrapAdmin(client: PoolClient, username: string, password: string) {
  const hashedPassword = await bcrypt.hash(password, 10)
  const result = await client.query(
    `INSERT INTO admin_users (username, hashed_password, role)
     VALUES ($1, $2, 'admin')
     ON CONFLICT (username)
     DO UPDATE SET
       hashed_password = EXCLUDED.hashed_password,
       role = 'admin'
     RETURNING id, username, role`,
    [username, hashedPassword],
  )

  return result.rows[0]
}

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  session: {
    strategy: 'jwt',
  },
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        username: { label: 'Username', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const username = credentials?.username?.trim()
        const password = credentials?.password

        if (!username || !password) {
          return null
        }

        let client
        try {
          client = await pool.connect()

          if (
            bootstrapAdminUsername &&
            bootstrapAdminPassword &&
            username === bootstrapAdminUsername &&
            password === bootstrapAdminPassword
          ) {
            const user = await ensureBootstrapAdmin(client, username, password)
            return {
              id: user.id.toString(),
              name: user.username,
              role: 'admin' as DashboardRole,
            }
          }

          let result
          try {
            result = await client.query(
              'SELECT id, username, hashed_password, role FROM admin_users WHERE username = $1 LIMIT 1',
              [username]
            )
          } catch {
            result = await client.query(
              'SELECT id, username, hashed_password FROM admin_users WHERE username = $1 LIMIT 1',
              [username]
            )
          }

          if (result.rows.length === 0) {
            return null
          }

          const user = result.rows[0]
          const passwordMatch = await bcrypt.compare(
            password,
            user.hashed_password
          )

          if (!passwordMatch) {
            return null
          }

          return {
            id: user.id.toString(),
            name: user.username,
            role: (user.role as DashboardRole | undefined) ?? 'admin',
          }
        } catch (err) {
          console.error('Auth error:', err)
          return null
        } finally {
          client?.release()
        }
      },
    }),
  ],
  pages: {
    signIn: '/login',
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.name = user.name
        token.role = user.role
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string
        session.user.name = token.name as string
        session.user.role = (token.role as DashboardRole) ?? 'admin'
      }
      return session
    },
  },
}
