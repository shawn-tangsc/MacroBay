import { describe, expect, it } from 'vitest'

import {
  clampPage,
  DEFAULT_RESOURCE_JOB_PAGE_SIZE,
  pageCount,
  RESOURCE_JOB_PAGE_SIZES,
  slicePage
} from './resourceJobPagination'

describe('resourceJobPagination', () => {
  it('offers 10 / 20 / 50 rows per page with 10 as the default', () => {
    expect([...RESOURCE_JOB_PAGE_SIZES]).toEqual([10, 20, 50])
    expect(DEFAULT_RESOURCE_JOB_PAGE_SIZE).toBe(10)
  })

  it('counts at least one page so the control never reads "page 1 of 0"', () => {
    expect(pageCount(0, 10)).toBe(1)
    expect(pageCount(1, 10)).toBe(1)
    expect(pageCount(10, 10)).toBe(1)
    expect(pageCount(11, 10)).toBe(2)
    expect(pageCount(18, 10)).toBe(2)
    expect(pageCount(21, 10)).toBe(3)
    expect(pageCount(18, 20)).toBe(1)
    expect(pageCount(18, 50)).toBe(1)
    expect(pageCount(0, 0)).toBe(1)
  })

  it('clamps an out-of-range page into the real page window', () => {
    expect(clampPage(1, 18, 10)).toBe(1)
    expect(clampPage(2, 18, 10)).toBe(2)
    expect(clampPage(3, 18, 10)).toBe(2)
    expect(clampPage(99, 18, 10)).toBe(2)
    expect(clampPage(0, 18, 10)).toBe(1)
    expect(clampPage(-3, 18, 10)).toBe(1)
    expect(clampPage(2, 3, 10)).toBe(1)
    expect(clampPage(2, 0, 10)).toBe(1)
    expect(clampPage(2.7, 18, 10)).toBe(2)
  })

  it('slices the visible window and never renders an empty page', () => {
    const items = Array.from({ length: 18 }, (_, index) => `job-${index + 1}`)

    expect(slicePage(items, 1, 10)).toEqual(items.slice(0, 10))
    expect(slicePage(items, 2, 10)).toEqual(items.slice(10, 18))
    expect(slicePage(items, 3, 10)).toEqual(items.slice(10, 18))
    expect(slicePage(items, 2, 20)).toEqual(items)
    expect(slicePage([], 1, 10)).toEqual([])
    expect(slicePage(['only'], 2, 10)).toEqual(['only'])
  })

  it('keeps the page window correct after a filter shrinks the list', () => {
    const all = Array.from({ length: 18 }, (_, index) => ({ id: `job-${index + 1}` }))
    const filtered = all.filter((item) => item.id === 'job-18')

    expect(pageCount(filtered.length, 10)).toBe(1)
    expect(clampPage(2, filtered.length, 10)).toBe(1)
    expect(slicePage(filtered, 2, 10)).toEqual(filtered)
  })
})
