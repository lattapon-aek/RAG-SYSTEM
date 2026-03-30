import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import bcrypt from 'bcryptjs'
import pg from 'pg'

const { Pool } = pg

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) continue
    const key = trimmed.slice(0, eqIndex).trim()
    const value = trimmed.slice(eqIndex + 1).trim()
    if (!(key in process.env)) {
      process.env[key] = value
    }
  }
}

function resolvePostgresUrl(rawUrl) {
  if (!rawUrl) throw new Error('POSTGRES_URL is required')
  const parsed = new URL(rawUrl)
  if (parsed.hostname === 'postgres') {
    parsed.hostname = 'localhost'
  }
  return parsed.toString()
}

function randomCredentials(role) {
  const suffix = crypto.randomBytes(4).toString('hex')
  return {
    username: `smoke_${role}_${suffix}`,
    password: `Smoke!${suffix}Pass1`,
  }
}

function applyCookies(cookieJar, response) {
  const setCookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : []
  for (const rawCookie of setCookies) {
    const first = rawCookie.split(';', 1)[0]
    const eqIndex = first.indexOf('=')
    if (eqIndex === -1) continue
    const name = first.slice(0, eqIndex)
    const value = first.slice(eqIndex + 1)
    cookieJar.set(name, value)
  }
}

function cookieHeader(cookieJar) {
  return Array.from(cookieJar.entries()).map(([name, value]) => `${name}=${value}`).join('; ')
}

async function login(dashboardUrl, username, password) {
  const cookieJar = new Map()

  const csrfRes = await fetch(`${dashboardUrl}/api/auth/csrf`, { redirect: 'manual' })
  applyCookies(cookieJar, csrfRes)
  const csrfBody = await csrfRes.json()
  const csrfToken = csrfBody?.csrfToken
  if (!csrfToken) {
    throw new Error('Failed to obtain CSRF token')
  }

  const form = new URLSearchParams({
    csrfToken,
    username,
    password,
    callbackUrl: `${dashboardUrl}/dashboard`,
    json: 'true',
  })

  const loginRes = await fetch(`${dashboardUrl}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookieHeader(cookieJar),
    },
    body: form.toString(),
    redirect: 'manual',
  })
  applyCookies(cookieJar, loginRes)

  if (![200, 302].includes(loginRes.status)) {
    throw new Error(`Login failed for ${username}: HTTP ${loginRes.status}`)
  }

  const hasSessionCookie = Array.from(cookieJar.keys()).some((name) => name.includes('next-auth.session-token'))
  if (!hasSessionCookie) {
    throw new Error(`Login did not yield a session cookie for ${username}`)
  }

  return cookieJar
}

async function assertPage(dashboardUrl, cookieJar, route, expectedText = null) {
  const res = await fetch(`${dashboardUrl}${route}`, {
    headers: { Cookie: cookieHeader(cookieJar) },
    redirect: 'manual',
  })
  if (res.status !== 200) {
    throw new Error(`Expected 200 for ${route}, got ${res.status}`)
  }
  const html = await res.text()
  if (expectedText && !html.includes(expectedText)) {
    throw new Error(`Expected "${expectedText}" in ${route}`)
  }
}

async function apiRequest(dashboardUrl, cookieJar, route, init = {}) {
  const headers = new Headers(init.headers || {})
  headers.set('Cookie', cookieHeader(cookieJar))
  const res = await fetch(`${dashboardUrl}${route}`, {
    ...init,
    headers,
    redirect: 'manual',
  })
  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  return { res, data }
}

async function assertRedirectToLogin(dashboardUrl, route) {
  const res = await fetch(`${dashboardUrl}${route}`, { redirect: 'manual' })
  const location = res.headers.get('location') ?? ''
  const redirectsToAuth = location.includes('/login') || location.includes('/api/auth/signin')
  if (![302, 307].includes(res.status) || !redirectsToAuth) {
    throw new Error(`Expected redirect to auth for ${route}, got ${res.status} ${location}`)
  }
}

async function assertForbiddenForOperator(dashboardUrl, cookieJar, route) {
  const res = await fetch(`${dashboardUrl}${route}`, {
    headers: { Cookie: cookieHeader(cookieJar) },
    redirect: 'manual',
  })
  const location = res.headers.get('location') ?? ''
  const redirectsAway = (
    location.includes('/login') ||
    location.includes('/api/auth/signin') ||
    location.includes('/dashboard')
  )
  if (![302, 307].includes(res.status) || !redirectsAway) {
    throw new Error(`Expected operator redirect away from ${route}, got ${res.status} ${location}`)
  }
}

async function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url))
  const repoRoot = path.resolve(scriptDir, '..', '..', '..')
  readEnvFile(path.join(repoRoot, '.env'))
  readEnvFile(path.join(repoRoot, 'platform', 'dashboard', '.env.local'))

  const postgresUrl = resolvePostgresUrl(process.env.POSTGRES_URL)
  const dashboardUrl = process.env.DASHBOARD_URL || 'http://localhost:3001'

  const pool = new Pool({ connectionString: postgresUrl })
  const createdUserIds = []

  try {
    const adminCreds = randomCredentials('admin')
    const operatorCreds = randomCredentials('operator')
    const adminHash = await bcrypt.hash(adminCreds.password, 10)
    const operatorHash = await bcrypt.hash(operatorCreds.password, 10)

    const adminRow = await pool.query(
      `INSERT INTO admin_users (username, hashed_password, role)
       VALUES ($1, $2, 'admin')
       RETURNING id`,
      [adminCreds.username, adminHash],
    )
    createdUserIds.push(adminRow.rows[0].id)

    const operatorRow = await pool.query(
      `INSERT INTO admin_users (username, hashed_password, role)
       VALUES ($1, $2, 'operator')
       RETURNING id`,
      [operatorCreds.username, operatorHash],
    )
    createdUserIds.push(operatorRow.rows[0].id)

    await assertRedirectToLogin(dashboardUrl, '/dashboard')

    const adminCookies = await login(dashboardUrl, adminCreds.username, adminCreds.password)
    await assertPage(dashboardUrl, adminCookies, '/dashboard', 'Admin Quick Access')
    await assertPage(dashboardUrl, adminCookies, '/quota')
    await assertPage(dashboardUrl, adminCookies, '/documents')
    await assertPage(dashboardUrl, adminCookies, '/cache')
    await assertPage(dashboardUrl, adminCookies, '/chat')
    await assertPage(dashboardUrl, adminCookies, '/admin-users')
    await assertPage(dashboardUrl, adminCookies, '/api-keys', 'API Keys')
    await assertPage(dashboardUrl, adminCookies, '/audit-log', 'Audit Log')

    const managedCreds = randomCredentials('viewer')
    const userCreateRes = await apiRequest(dashboardUrl, adminCookies, '/api/admin-users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: managedCreds.username,
        password: managedCreds.password,
        role: 'viewer',
      }),
    })
    if (userCreateRes.res.status !== 201 || !userCreateRes.data?.id) {
      throw new Error(`Failed to create admin user: HTTP ${userCreateRes.res.status}`)
    }
    createdUserIds.push(userCreateRes.data.id)

    const resetPassword = `${managedCreds.password}!reset`
    const userResetRes = await apiRequest(
      dashboardUrl,
      adminCookies,
      `/api/admin-users/${userCreateRes.data.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'operator', password: resetPassword }),
      },
    )
    if (userResetRes.res.status !== 200) {
      throw new Error(`Failed to update/reset admin user: HTTP ${userResetRes.res.status}`)
    }

    const managedCookies = await login(dashboardUrl, managedCreds.username, resetPassword)
    await assertPage(dashboardUrl, managedCookies, '/documents')
    await assertForbiddenForOperator(dashboardUrl, managedCookies, '/admin-users')

    const smokeClientId = `smoke-client-${crypto.randomBytes(3).toString('hex')}`
    const apiKeyCreate = await apiRequest(dashboardUrl, adminCookies, '/api/api-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: smokeClientId,
        label: 'smoke key',
      }),
    })
    if (apiKeyCreate.res.status !== 201 || !apiKeyCreate.data?.record?.id || !apiKeyCreate.data?.plaintext_key) {
      throw new Error(`Failed to create API key: HTTP ${apiKeyCreate.res.status}`)
    }

    const ragWithKey = await fetch('http://localhost:8000/metrics/summary', {
      headers: { 'X-API-Key': apiKeyCreate.data.plaintext_key },
    })
    if (ragWithKey.status !== 200) {
      throw new Error(`Expected valid API key to access rag-service, got HTTP ${ragWithKey.status}`)
    }

    const ragWithBadKey = await fetch('http://localhost:8000/metrics/summary', {
      headers: { 'X-API-Key': `${apiKeyCreate.data.plaintext_key}-bad` },
    })
    if (ragWithBadKey.status !== 401) {
      throw new Error(`Expected invalid API key to fail, got HTTP ${ragWithBadKey.status}`)
    }

    const quotaSet = await apiRequest(dashboardUrl, adminCookies, `/api/quota/${smokeClientId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ daily_limit: 1234 }),
    })
    if (quotaSet.res.status !== 200) {
      throw new Error(`Failed to set quota override: HTTP ${quotaSet.res.status}`)
    }

    const quotaReset = await apiRequest(dashboardUrl, adminCookies, `/api/quota/${smokeClientId}`, {
      method: 'DELETE',
    })
    if (quotaReset.res.status !== 200) {
      throw new Error(`Failed to clear quota override: HTTP ${quotaReset.res.status}`)
    }

    const apiKeyRevoke = await apiRequest(
      dashboardUrl,
      adminCookies,
      `/api/api-keys/${apiKeyCreate.data.record.id}`,
      { method: 'DELETE' },
    )
    if (apiKeyRevoke.res.status !== 200) {
      throw new Error(`Failed to revoke API key: HTTP ${apiKeyRevoke.res.status}`)
    }

    const auditRes = await apiRequest(dashboardUrl, adminCookies, '/api/admin-action-log?limit=20')
    if (auditRes.res.status !== 200 || !Array.isArray(auditRes.data)) {
      throw new Error(`Failed to load admin action log: HTTP ${auditRes.res.status}`)
    }
    const hasQuotaAudit = auditRes.data.some(
      (entry) => entry.target_id === smokeClientId && entry.resource_type === 'quota',
    )
    if (!hasQuotaAudit) {
      throw new Error('Expected quota override audit entry after dashboard API calls')
    }
    const hasAdminUserAudit = auditRes.data.some(
      (entry) => entry.target_id === userCreateRes.data.id && entry.resource_type === 'admin_user',
    )
    if (!hasAdminUserAudit) {
      throw new Error('Expected admin user audit entry after create/reset flow')
    }
    const hasApiKeyAudit = auditRes.data.some(
      (entry) => entry.target_id === apiKeyCreate.data.record.id && entry.resource_type === 'api_key',
    )
    if (!hasApiKeyAudit) {
      throw new Error('Expected API key audit entry after create/revoke flow')
    }

    const operatorCookies = await login(dashboardUrl, operatorCreds.username, operatorCreds.password)
    await assertPage(dashboardUrl, operatorCookies, '/documents')
    await assertForbiddenForOperator(dashboardUrl, operatorCookies, '/admin-users')
    await assertForbiddenForOperator(dashboardUrl, operatorCookies, '/audit-log')

    console.log('PASS dashboard UI smoke completed')
  } finally {
    if (createdUserIds.length > 0) {
      await pool.query(
        'DELETE FROM admin_users WHERE id = ANY($1::uuid[])',
        [createdUserIds],
      )
    }
    await pool.end()
  }
}

main().catch((error) => {
  console.error(`FAIL dashboard UI smoke: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
