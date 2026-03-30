'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

const REFRESH_INTERVAL_MS = 30_000

export default function RefreshButton() {
  const router = useRouter()
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(() => new Date())
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL_MS / 1000)

  function emitRefresh() {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('dashboard:refresh'))
    }
  }

  useEffect(() => {
    const refreshTimer = setInterval(() => {
      router.refresh()
      setLastRefreshed(new Date())
      setCountdown(REFRESH_INTERVAL_MS / 1000)
      emitRefresh()
    }, REFRESH_INTERVAL_MS)

    const countdownTimer = setInterval(() => {
      setCountdown((prev) => (prev > 0 ? prev - 1 : 0))
    }, 1000)

    return () => {
      clearInterval(refreshTimer)
      clearInterval(countdownTimer)
    }
  }, [router])

  function handleManualRefresh() {
    router.refresh()
    setLastRefreshed(new Date())
    setCountdown(REFRESH_INTERVAL_MS / 1000)
    emitRefresh()
  }

  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-gray-400">
        {lastRefreshed ? `Last updated: ${lastRefreshed.toLocaleTimeString()} · next refresh in ${countdown}s` : `Next refresh in ${countdown}s`}
      </span>
      <button
        onClick={handleManualRefresh}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg transition-colors"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        Refresh
      </button>
    </div>
  )
}
