'use client'

import { useRef } from 'react'

interface Pill {
  label: string
  value: string
}

interface Props {
  search: string
  onSearchChange: (v: string) => void
  pills?: { label: string; options: Pill[]; value: string; onChange: (v: string) => void }[]
  extras?: React.ReactNode
  resultCount?: number
  totalCount?: number
  onReset?: () => void
}

export default function FilterBar({
  search,
  onSearchChange,
  pills = [],
  extras,
  resultCount,
  totalCount,
  onReset,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="bg-gray-800 rounded-xl border border-gray-700 p-4 mb-6 space-y-3">
      {/* Search + Reset row */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500"
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search…"
            className="w-full bg-gray-900 border border-gray-600 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-lg pl-9 pr-3 py-2 text-sm text-gray-200 placeholder-gray-500 outline-none transition-colors"
          />
          {search && (
            <button
              onClick={() => { onSearchChange(''); inputRef.current?.focus() }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {onReset && (
          <button
            onClick={onReset}
            className="text-xs text-gray-500 hover:text-gray-300 px-3 py-2 rounded-lg border border-gray-700 hover:border-gray-600 transition-colors whitespace-nowrap"
          >
            Reset
          </button>
        )}

        {resultCount !== undefined && totalCount !== undefined && (
          <span className="text-xs text-gray-500 whitespace-nowrap">
            {resultCount === totalCount
              ? `${totalCount} items`
              : `${resultCount} / ${totalCount}`}
          </span>
        )}
      </div>

      {/* Pill filters */}
      {pills.map((group) => (
        <div key={group.label} className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-500 w-16 shrink-0">{group.label}</span>
          <div className="flex gap-1.5 flex-wrap">
            {group.options.map((opt) => (
              <button
                key={opt.value}
                onClick={() => group.onChange(opt.value)}
                className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                  group.value === opt.value
                    ? 'bg-blue-600 border-blue-500 text-white'
                    : 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600 hover:text-white'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      ))}

      {/* Extra controls (date pickers, sort dropdowns, etc.) */}
      {extras}
    </div>
  )
}
