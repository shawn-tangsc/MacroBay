/** 每页条数候选：默认 10，保证真机 18 条时两页且分页控件可见。 */
export const RESOURCE_JOB_PAGE_SIZES = [10, 20, 50] as const

export const DEFAULT_RESOURCE_JOB_PAGE_SIZE: number = RESOURCE_JOB_PAGE_SIZES[0]

/**
 * 页数下限为 1：0 项时也读作「第 1 / 1 页」，不出现「第 1 / 0 页」。
 * 非法的 pageSize（<= 0 / NaN）按 1 项/页处理。
 */
export function pageCount(total: number, pageSize: number): number {
  const size = Number.isFinite(pageSize) && pageSize > 0 ? Math.floor(pageSize) : 1
  const count = Number.isFinite(total) && total > 0 ? Math.floor(total) : 0
  return Math.max(1, Math.ceil(count / size))
}

/** 把任意页码钳进 [1, pageCount]，筛选/每页条数变化后不会停留在空页。 */
export function clampPage(page: number, total: number, pageSize: number): number {
  const pages = pageCount(total, pageSize)
  const requested = Number.isFinite(page) ? Math.floor(page) : 1
  return Math.min(Math.max(requested, 1), pages)
}

/** 客户端分页：投影本来就是全量只读列表，这里只切当前窗口。 */
export function slicePage<T>(items: readonly T[], page: number, pageSize: number): T[] {
  const size = Number.isFinite(pageSize) && pageSize > 0 ? Math.floor(pageSize) : 1
  const current = clampPage(page, items.length, size)
  const start = (current - 1) * size
  return items.slice(start, start + size)
}
