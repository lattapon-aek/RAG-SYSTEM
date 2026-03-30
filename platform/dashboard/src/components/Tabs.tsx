'use client'

interface Tab {
  id: string
  label: string
  count?: number
}

interface TabsProps {
  tabs: Tab[]
  active: string
  onChange: (id: string) => void
}

export default function Tabs({ tabs, active, onChange }: TabsProps) {
  return (
    <div className="flex gap-0 border-b border-gray-800 shrink-0">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
            active === t.id
              ? 'border-purple-500 text-white'
              : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-600'
          }`}
        >
          {t.label}
          {t.count !== undefined && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono ${
              active === t.id ? 'bg-purple-600/40 text-purple-300' : 'bg-gray-700 text-gray-400'
            }`}>
              {t.count}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}
