'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function GapActions({ id }: { id: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState<'promote' | 'ignore' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<'promoted' | 'ignored' | null>(null)

  async function handleAction(action: 'promote' | 'ignore') {
    setLoading(action)
    setError(null)
    try {
      const res = await fetch(`/api/knowledge-gaps/${id}/${action}`, {
        method: 'POST',
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error || `Request failed with status ${res.status}`)
      }
      setDone(action === 'promote' ? 'promoted' : 'ignored')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setLoading(null)
    }
  }

  if (done) {
    return (
      <span
        className={`text-xs font-medium px-2.5 py-1 rounded-full border ${
          done === 'promoted'
            ? 'bg-blue-500/20 text-blue-400 border-blue-500/30'
            : 'bg-gray-500/20 text-gray-400 border-gray-500/30'
        }`}
      >
        {done === 'promoted' ? 'Sent to Approvals' : 'Dismissed'}
      </span>
    )
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-red-400">{error}</span>}
      <button
        onClick={() => handleAction('promote')}
        disabled={loading !== null}
        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-medium rounded-lg transition-colors"
      >
        {loading === 'promote' ? '...' : 'Send to Approvals'}
      </button>
      <button
        onClick={() => handleAction('ignore')}
        disabled={loading !== null}
        className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed text-gray-300 text-xs font-medium rounded-lg transition-colors"
      >
        {loading === 'ignore' ? '...' : 'Dismiss'}
      </button>
    </div>
  )
}
