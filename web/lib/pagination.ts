export type PageRequest = {
  page: number
  pageSize: number
}

export type PageResult<T> = {
  items: T[]
  page: number
  pageSize: number
  total: number
  totalPages: number
  hasNext: boolean
  hasPrev: boolean
}

export const DEFAULT_PAGE_SIZE = 10
export const PAGE_SIZE_OPTIONS = [5, 10, 25, 50] as const
export const MAX_PAGE_SIZE = 50

export function normalizePageRequest(raw: Partial<PageRequest> | undefined): PageRequest {
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(raw?.pageSize ?? DEFAULT_PAGE_SIZE)))
  const page = Math.max(1, Math.floor(raw?.page ?? 1))
  return { page, pageSize }
}

export function paginate<T>(items: readonly T[], request?: Partial<PageRequest>): PageResult<T> {
  const { page, pageSize } = normalizePageRequest(request)
  const total = items.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1)
  const safePage = Math.min(page, totalPages)
  const start = (safePage - 1) * pageSize
  return {
    items: items.slice(start, start + pageSize) as T[],
    page: safePage,
    pageSize,
    total,
    totalPages,
    hasNext: safePage < totalPages,
    hasPrev: safePage > 1,
  }
}

export type SortDir = 'asc' | 'desc'

export function sortBy<T>(items: readonly T[], key: keyof T, dir: SortDir = 'asc'): T[] {
  const copy = [...items]
  copy.sort((a, b) => {
    const av = a[key]
    const bv = b[key]
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' })
    return dir === 'asc' ? cmp : -cmp
  })
  return copy
}

export function caseInsensitiveIncludes(haystack: string, needle: string): boolean {
  if (!needle.trim()) return true
  return haystack.toLowerCase().includes(needle.trim().toLowerCase())
}
