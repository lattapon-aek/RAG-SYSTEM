'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

const COOLDOWN_SECONDS = 60

type Action = 'analysis' | 'gaps'
type TriggerResult = { label: string; value: string } | null

function useCooldown() {
  const [remaining, setRemaining] = useState<Record<Action, number>>({ analysis: 0, gaps: 0 })
  const timers = useRef<Record<Action, ReturnType<typeof setInterval> | null>>({ analysis: null, gaps: null })

  function start(action: Action) {
    if (timers.current[action]) clearInterval(timers.current[action]!)
    setRemaining((prev) => ({ ...prev, [action]: COOLDOWN_SECONDS }))
    timers.current[action] = setInterval(() => {
      setRemaining((prev) => {
        const next = prev[action] - 1
        if (next <= 0) {
          clearInterval(timers.current[action]!)
          timers.current[action] = null
          return { ...prev, [action]: 0 }
        }
        return { ...prev, [action]: next }
      })
    }, 1000)
  }

  useEffect(() => () => {
    if (timers.current.analysis) clearInterval(timers.current.analysis)
    if (timers.current.gaps) clearInterval(timers.current.gaps)
  }, [])

  return { remaining, start }
}

export default function TriggerButtons() {
  const router = useRouter()
  const [loading, setLoading] = useState<Action | null>(null)
  const [results, setResults] = useState<Record<Action, TriggerResult>>({ analysis: null, gaps: null })
  const [errors, setErrors] = useState<Record<Action, string | null>>({ analysis: null, gaps: null })
  const { remaining, start: startCooldown } = useCooldown()

  async function trigger(action: Action) {
    setLoading(action)
    setErrors((prev) => ({ ...prev, [action]: null }))
    try {
      const url = action === 'analysis'
        ? '/api/self-learning/trigger'
        : '/api/self-learning/process-gaps'
      const res = await fetch(url, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error || `Failed with status ${res.status}`)
      }
      const data = await res.json()
      setResults((prev) => ({
        ...prev,
        [action]: action === 'analysis'
          ? { label: 'Proposed', value: String(data.proposed ?? 0) }
          : { label: 'Promoted', value: String(data.promoted ?? 0) },
      }))
      startCooldown(action)
      router.refresh()
      window.dispatchEvent(new Event('dashboard:refresh'))
    } catch (e) {
      setErrors((prev) => ({ ...prev, [action]: e instanceof Error ? e.message : 'Action failed' }))
    } finally {
      setLoading(null)
    }
  }

  function renderButton(action: Action, label: string, colorClass: string, icon: React.ReactNode) {
    const isLoading = loading === action
    const cooldown = remaining[action]
    const disabled = loading !== null || cooldown > 0
    const result = results[action]
    const error = errors[action]

    return (
      <div className="flex flex-col items-end gap-1">
        <button
          onClick={() => trigger(action)}
          disabled={disabled}
          className={`flex items-center gap-2 px-4 py-2 ${colorClass} disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors`}
        >
          {isLoading ? (
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : icon}
          {cooldown > 0 ? `${label} (${cooldown}s)` : label}
        </button>

        {error && (
          <span className="text-xs text-red-400">{error}</span>
        )}
        {result && cooldown > 0 && (
          <span className="text-xs text-green-400">
            {result.label}: {result.value}
          </span>
        )}
      </div>
    )
  }

  return (
    <div className="flex items-start gap-3">
      {renderButton(
        'analysis',
        'Trigger Analysis',
        'bg-purple-600 hover:bg-purple-700',
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>,
      )}
      {renderButton(
        'gaps',
        'Process Gaps',
        'bg-blue-600 hover:bg-blue-700',
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>,
      )}
    </div>
  )
}
