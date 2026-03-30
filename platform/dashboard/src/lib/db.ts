import { Pool } from 'pg'

let pool: Pool | null = null

export function getDashboardPgPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.POSTGRES_URL,
    })
  }

  return pool
}
