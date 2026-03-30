'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

const inputCls = 'w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white outline-none focus:border-purple-500'
const btnCls = 'rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed'
const btnGhost = 'rounded-lg border border-gray-700 px-3 py-2 text-xs text-gray-200 hover:bg-gray-800'

export default function CreateMemoryProfileUI() {
  const router = useRouter()
  const [profileKey, setProfileKey] = useState('')
  const [label, setLabel] = useState('')
  const [notes, setNotes] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  async function createProfile() {
    const normalized = profileKey.trim()
    if (!normalized) {
      setError('Profile key is required')
      return
    }

    setCreating(true)
    setError('')
    try {
      const res = await fetch('/api/memory/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: normalized,
          label: label.trim() || null,
          notes: notes.trim() || null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || data?.detail || `HTTP ${res.status}`)
      router.push(`/memory/${encodeURIComponent(normalized)}`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create memory profile')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-8">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Create Memory Profile</h1>
          <p className="mt-1 text-sm text-gray-400">
            Create an empty, unique profile bucket first, then add memory entries later from the profile detail page.
          </p>
        </div>
        <Link href="/memory" className={btnGhost}>
          Back to Profiles
        </Link>
      </div>

      {error && <div className="rounded-xl border border-red-800 bg-red-900/20 p-4 text-sm text-red-400">{error}</div>}

      <section className="rounded-2xl border border-gray-800 bg-gray-900/70 p-5">
        <div className="grid gap-4">
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-gray-500">Profile Key</label>
            <input
              value={profileKey}
              onChange={(e) => setProfileKey(e.target.value)}
              placeholder="e.g. customer-123"
              className={inputCls}
            />
            <p className="mt-1 text-[11px] text-gray-500">This key must be unique.</p>
          </div>
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-gray-500">Label</label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Optional label"
              className={inputCls}
            />
          </div>
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-gray-500">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              placeholder="Optional notes about this profile"
              className={inputCls}
            />
          </div>
          <div className="flex gap-2">
            <button onClick={() => void createProfile()} disabled={creating} className={btnCls}>
              {creating ? 'Creating…' : 'Create Profile'}
            </button>
            <button
              onClick={() => {
                setProfileKey('')
                setLabel('')
                setNotes('')
                setError('')
              }}
              className={btnGhost}
            >
              Reset
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
