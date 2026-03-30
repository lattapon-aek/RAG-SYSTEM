'use client'

import { useEffect, useState, useTransition } from 'react'
import type { AdminUserRecord } from '@/types'

const ROLE_OPTIONS: AdminUserRecord['role'][] = ['viewer', 'operator', 'admin']

function fmtDate(value: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

export default function AdminUsersUI() {
  const [users, setUsers] = useState<AdminUserRecord[]>([])
  const [createUsername, setCreateUsername] = useState('')
  const [createPassword, setCreatePassword] = useState('')
  const [createRole, setCreateRole] = useState<AdminUserRecord['role']>('viewer')
  const [resetPasswords, setResetPasswords] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [savingUserId, setSavingUserId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [message, setMessage] = useState('')
  const [isPending, startTransition] = useTransition()
  const createValidation =
    !createUsername.trim()
      ? 'Username is required'
      : createPassword.length < 10
        ? 'Password must be at least 10 characters'
        : ''

  async function loadUsers() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/admin-users')
      const data = await res.json().catch(() => [])
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
      setUsers(Array.isArray(data) ? data : [])
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load admin users')
      setUsers([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadUsers()
  }, [])

  function updateRole(id: string, role: AdminUserRecord['role']) {
    setMessage('')
    setError('')
    setSavingUserId(id)
    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin-users/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)

        setUsers((current) =>
          current.map((user) => (user.id === id ? { ...user, role: data.role } : user)),
        )
        setMessage(`Updated role to ${role}`)
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to update role')
      } finally {
        setSavingUserId(null)
      }
    })
  }

  async function createUser() {
    setMessage('')
    setError('')
    if (!createUsername.trim()) {
      setError('Username is required')
      return
    }
    if (createPassword.length < 10) {
      setError('Password must be at least 10 characters')
      return
    }
    setCreating(true)
    try {
      const res = await fetch('/api/admin-users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: createUsername.trim(),
          password: createPassword,
          role: createRole,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)

      setUsers((current) => {
        const next = [...current, data as AdminUserRecord]
        next.sort((a, b) => a.username.localeCompare(b.username))
        return next
      })
      setCreateUsername('')
      setCreatePassword('')
      setCreateRole('viewer')
      setMessage(`Created user ${data.username}`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create admin user')
    } finally {
      setCreating(false)
    }
  }

  async function resetPassword(id: string) {
    const password = resetPasswords[id] ?? ''
    setMessage('')
    setError('')
    setSavingUserId(id)
    try {
      const res = await fetch(`/api/admin-users/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)

      setResetPasswords((current) => ({ ...current, [id]: '' }))
      setMessage(`Reset password for ${data.username}`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to reset password')
    } finally {
      setSavingUserId(null)
    }
  }

  return (
    <div className="max-w-5xl space-y-6 p-8">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard Users</h1>
          <p className="mt-1 text-sm text-gray-400">
            Manage dashboard login accounts. The UUID shown under each username is the user ID.
          </p>
        </div>
        <button
          onClick={() => void loadUsers()}
          className="rounded-lg border border-gray-700 px-3 py-2 text-xs font-medium text-gray-200 transition-colors hover:border-gray-500 hover:bg-gray-800"
        >
          Refresh
        </button>
      </div>

      {error && <div className="rounded-xl border border-red-800 bg-red-900/20 p-4 text-sm text-red-400">{error}</div>}
      {message && <div className="rounded-xl border border-green-800 bg-green-900/20 p-4 text-sm text-green-400">{message}</div>}

      <section className="rounded-2xl border border-gray-800 bg-gray-900/70 p-5">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-white">Create User</h2>
          <p className="mt-1 text-sm text-gray-400">
            Add a new dashboard account with an initial role and password. This does not affect service client IDs.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-[1.2fr_1.2fr_0.8fr_auto]">
          <input
            value={createUsername}
            onChange={(event) => setCreateUsername(event.target.value)}
            placeholder="Username"
            className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white outline-none transition-colors placeholder:text-gray-600 focus:border-purple-500"
          />
          <input
            type="password"
            value={createPassword}
            onChange={(event) => setCreatePassword(event.target.value)}
            placeholder="Initial password"
            className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white outline-none transition-colors placeholder:text-gray-600 focus:border-purple-500"
          />
          <select
            value={createRole}
            onChange={(event) => setCreateRole(event.target.value as AdminUserRecord['role'])}
            className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-purple-500"
          >
            {ROLE_OPTIONS.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
          <button
            disabled={creating}
            onClick={() => void createUser()}
            className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {creating ? 'Creating…' : 'Create User'}
          </button>
        </div>
        <p className={`mt-3 text-xs ${createValidation ? 'text-amber-400' : 'text-gray-500'}`}>
          {createValidation || 'Set a username, password, and role, then click Create User.'}
        </p>
      </section>

      <section className="rounded-2xl border border-gray-800 bg-gray-900/70 p-5">
        <div className="mb-4 grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-gray-800 bg-gray-950/70 p-4">
            <p className="text-xs uppercase tracking-wider text-gray-500">Accounts</p>
            <p className="mt-2 text-2xl font-bold text-white">{loading ? '—' : users.length}</p>
          </div>
          <div className="rounded-xl border border-gray-800 bg-gray-950/70 p-4">
            <p className="text-xs uppercase tracking-wider text-gray-500">Admins</p>
            <p className="mt-2 text-2xl font-bold text-purple-400">
              {loading ? '—' : users.filter((user) => user.role === 'admin').length}
            </p>
          </div>
          <div className="rounded-xl border border-gray-800 bg-gray-950/70 p-4">
            <p className="text-xs uppercase tracking-wider text-gray-500">Operators / Viewers</p>
            <p className="mt-2 text-2xl font-bold text-blue-400">
              {loading ? '—' : users.filter((user) => user.role !== 'admin').length}
            </p>
          </div>
        </div>

        {loading ? (
          <div className="space-y-2">
            {[...Array(4)].map((_, index) => (
              <div key={index} className="h-14 animate-pulse rounded-xl bg-gray-800/50" />
            ))}
          </div>
        ) : users.length === 0 ? (
          <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-6 text-sm text-gray-400">
            No admin users found.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-gray-800">
            <div className="grid grid-cols-[1.1fr_0.7fr_0.9fr_0.8fr_1.1fr] gap-4 border-b border-gray-800 bg-gray-950/80 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
              <span>Username</span>
              <span>Role</span>
              <span>Created</span>
              <span>Change Role</span>
              <span>Reset Password</span>
            </div>
            <div className="divide-y divide-gray-800">
              {users.map((user) => (
                <div key={user.id} className="grid grid-cols-[1.1fr_0.7fr_0.9fr_0.8fr_1.1fr] gap-4 px-4 py-3 text-sm">
                  <div>
                    <p className="font-medium text-white">{user.username}</p>
                    <p className="mt-1 font-mono text-xs text-gray-500">{user.id.slice(0, 8)}…</p>
                  </div>
                  <span className={`inline-flex h-fit rounded-full border px-2 py-1 text-xs uppercase tracking-wider ${
                    user.role === 'admin'
                      ? 'border-red-700/40 bg-red-900/20 text-red-300'
                      : user.role === 'operator'
                      ? 'border-blue-700/40 bg-blue-900/20 text-blue-300'
                      : 'border-gray-700/40 bg-gray-800/60 text-gray-400'
                  }`}>
                    {user.role}
                  </span>
                  <span className="text-gray-400">{fmtDate(user.created_at)}</span>
                  <select
                    value={user.role}
                    disabled={savingUserId === user.id || isPending}
                    onChange={(event) => updateRole(user.id, event.target.value as AdminUserRecord['role'])}
                    className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-purple-500 disabled:opacity-50"
                  >
                    {ROLE_OPTIONS.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={resetPasswords[user.id] ?? ''}
                      onChange={(event) =>
                        setResetPasswords((current) => ({ ...current, [user.id]: event.target.value }))
                      }
                      placeholder="New password"
                      className="min-w-0 flex-1 rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white outline-none transition-colors placeholder:text-gray-600 focus:border-purple-500"
                    />
                    <button
                      disabled={savingUserId === user.id || (resetPasswords[user.id] ?? '').length < 10}
                      onClick={() => void resetPassword(user.id)}
                      className="rounded-lg border border-gray-700 px-3 py-2 text-xs font-medium text-gray-200 transition-colors hover:border-gray-500 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Reset
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
