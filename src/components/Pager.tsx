import type { PageResult } from '../lib/pagination'
import { PAGE_SIZE_OPTIONS } from '../lib/pagination'

export function Pager<T>({
  page,
  onPage,
  onPageSize,
}: {
  page: PageResult<T>
  onPage: (n: number) => void
  onPageSize?: (n: number) => void
}) {
  if (page.total === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-forest-700 mt-4">
      <button
        type="button"
        className="btn-ghost text-xs disabled:opacity-40"
        disabled={!page.hasPrev}
        onClick={() => onPage(page.page - 1)}
      >
        Previous
      </button>
      <span>
        Page {page.page} of {page.totalPages} · {page.total} records
      </span>
      <button
        type="button"
        className="btn-ghost text-xs disabled:opacity-40"
        disabled={!page.hasNext}
        onClick={() => onPage(page.page + 1)}
      >
        Next
      </button>
      {onPageSize && (
        <label className="ml-auto flex items-center gap-2">
          Page size
          <select
            className="field py-1 text-xs"
            value={page.pageSize}
            onChange={(e) => onPageSize(Number(e.target.value))}
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  )
}
