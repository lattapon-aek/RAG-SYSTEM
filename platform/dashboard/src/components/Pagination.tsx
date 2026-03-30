'use client'

interface Props {
  page: number
  totalPages: number
  onPageChange: (p: number) => void
  pageSize: number
  onPageSizeChange: (s: number) => void
  pageSizeOptions?: number[]
  totalItems?: number
}

export default function Pagination({
  page,
  totalPages,
  onPageChange,
  pageSize,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100],
  totalItems,
}: Props) {
  const showSizeSelector = pageSizeOptions.length > 1
  const showPageNav = totalPages > 1

  if (!showSizeSelector && !showPageNav) return null

  const pages = Array.from({ length: totalPages }, (_, i) => i + 1)
  const range = 2
  const shown = pages.filter(
    (p) => p === 1 || p === totalPages || Math.abs(p - page) <= range
  )

  const from = totalItems != null ? (page - 1) * pageSize + 1 : null
  const to = totalItems != null ? Math.min(page * pageSize, totalItems) : null

  return (
    <div className="flex items-center justify-between mt-4 px-1">
      <div className="flex items-center gap-3">
        {totalItems != null && (
          <span className="text-xs text-gray-500">
            {totalItems === 0
              ? '0 results'
              : `${from}–${to} of ${totalItems}`}
          </span>
        )}
        {showSizeSelector && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Rows per page</span>
            <select
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="bg-gray-800 border border-gray-600 text-gray-300 text-xs rounded-lg px-2 py-1 outline-none focus:border-blue-500"
            >
              {pageSizeOptions.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {showPageNav && (
        <div className="flex items-center gap-1">
          <button
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          {shown.map((p, i) => {
            const prev = shown[i - 1]
            const gap = prev && p - prev > 1
            return (
              <span key={p} className="flex items-center gap-1">
                {gap && <span className="text-gray-600 text-xs px-1">…</span>}
                <button
                  onClick={() => onPageChange(p)}
                  className={`min-w-[2rem] h-8 rounded-lg text-xs font-medium transition-colors ${
                    p === page
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-400 hover:text-white hover:bg-gray-700'
                  }`}
                >
                  {p}
                </button>
              </span>
            )
          })}

          <button
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      )}
    </div>
  )
}
