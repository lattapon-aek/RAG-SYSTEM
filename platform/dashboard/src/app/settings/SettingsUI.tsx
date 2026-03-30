'use client'

import { useState } from 'react'
import SystemOverviewPanel from '../dashboard/SystemOverviewPanel'

export default function SettingsUI() {
  const [triggerLoading, setTriggerLoading] = useState(false)
  const [gapsLoading, setGapsLoading] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  async function runAction(endpoint: string, successMsg: (d: Record<string, number>) => string) {
    setMsg(''); setErr('')
    try {
      const res = await fetch(endpoint, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
      setMsg(successMsg(data))
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed')
    }
  }

  return (
    <div className="p-8 max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-sm text-gray-400 mt-1">System operations and configuration reference</p>
      </div>

      {msg && <div className="rounded-xl border border-green-800 bg-green-900/20 px-4 py-3 text-sm text-green-400">{msg}</div>}
      {err && <div className="rounded-xl border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-400">{err}</div>}

      {/* System Overview */}
      <SystemOverviewPanel />

      {/* Self-Learning */}
      <section className="rounded-2xl border border-gray-800 bg-gray-900/70 divide-y divide-gray-800">
        <div className="px-5 py-4">
          <h2 className="text-sm font-semibold text-white">Self-Learning Pipeline</h2>
          <p className="text-xs text-gray-500 mt-0.5">Manually run analysis or push recurring gaps to Approvals</p>
        </div>
        <div className="px-5 py-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm text-gray-200">Run Analysis</p>
            <p className="text-xs text-gray-500 mt-0.5">Analyse recent interactions → propose knowledge candidates</p>
          </div>
          <button
            disabled={triggerLoading}
            onClick={async () => {
              setTriggerLoading(true)
              await runAction('/api/self-learning/trigger', (d) => `${d.proposed ?? 0} candidate(s) proposed`)
              setTriggerLoading(false)
            }}
            className="shrink-0 text-xs px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white transition-colors disabled:opacity-50"
          >
            {triggerLoading ? 'Running…' : 'Run'}
          </button>
        </div>
        <div className="px-5 py-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm text-gray-200">Process Knowledge Gaps</p>
            <p className="text-xs text-gray-500 mt-0.5">Promote recurring gaps (≥ threshold) to Approvals queue</p>
          </div>
          <button
            disabled={gapsLoading}
            onClick={async () => {
              setGapsLoading(true)
              await runAction('/api/self-learning/process-gaps', (d) => `${d.promoted ?? 0} gap(s) promoted`)
              setGapsLoading(false)
            }}
            className="shrink-0 text-xs px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors disabled:opacity-50"
          >
            {gapsLoading ? 'Running…' : 'Run'}
          </button>
        </div>
      </section>
    </div>
  )
}
