import { describe, expect, it } from 'vitest'

import { parseNarwhalCalendarPage } from './narwhalCalendarParser'

const entry = (overrides: Record<string, unknown> = {}) => ({
  release_id: 'rel-1', at: '2026-11-13T13:30:00Z', timezone: 'America/New_York',
  series_id: 'usa-cpi', name: 'Consumer prices', country: 'USA', status: 'scheduled',
  values: [{ measure: 'cpi_yoy', previous: '3.7', consensus: '3.9' }],
  ...overrides
})

const page = (releases: unknown[], next?: string) => ({ releases, ...(next === undefined ? {} : { next_cursor: next }) })

describe('narwhal calendar parser', () => {
  it('rejects a page whose top level is not { releases, next_cursor? }', () => {
    for (const raw of [null, [], {}, { releases: 'x' }, { releases: [], next_cursor: 3 }]) {
      expect(parseNarwhalCalendarPage(raw, { asOf: '2026-11-13T00:00:00Z' })).toEqual({ state: 'failed', failureCode: 'response-shape-invalid' })
    }
  })

  it('keeps a release whose series_id we never registered — unknown is not absent', () => {
    const result = parseNarwhalCalendarPage(page([entry({ series_id: 'never-heard-of-this', family: 'unknown-family' })]), { asOf: '2026-11-13T00:00:00Z' })
    expect(result.state).toBe('succeeded')
    if (result.state !== 'succeeded') return
    expect(result.releases).toHaveLength(1)
    expect(result.releases[0]!.seriesId).toBe('never-heard-of-this')
  })

  it('accepts an empty values array: it is a release with no measure yet, not an error', () => {
    const result = parseNarwhalCalendarPage(page([entry({ values: [] })]), { asOf: '2026-11-13T00:00:00Z' })
    if (result.state !== 'succeeded') throw new Error('expected success')
    expect(result.releases[0]!.values).toEqual([])
  })

  it('preserves the source order — grouping and sorting belong to the query layer', () => {
    const result = parseNarwhalCalendarPage(page([
      entry({ release_id: 'b', at: '2026-11-13T21:00:00Z' }),
      entry({ release_id: 'a', at: '2026-11-13T09:00:00Z' })
    ]), { asOf: '2026-11-13T00:00:00Z' })
    if (result.state !== 'succeeded') throw new Error('expected success')
    expect(result.releases.map(release => release.releaseId)).toEqual(['b', 'a'])
  })

  it('carries date_basis through, defaulting to exact when the source omits it', () => {
    const result = parseNarwhalCalendarPage(page([
      entry({ release_id: 'ind', date_basis: 'indicative' }),
      entry({ release_id: 'plain' })
    ]), { asOf: '2026-11-13T00:00:00Z' })
    if (result.state !== 'succeeded') throw new Error('expected success')
    expect(result.releases.map(release => release.dateBasis)).toEqual(['indicative', 'exact'])
  })

  it('treats next_cursor: null as the end of pages, not as a broken shape', () => {
    // 实测：最后一页返回的是 `"next_cursor": null`（不是缺字段）。
    const result = parseNarwhalCalendarPage({ releases: [entry()], next_cursor: null }, { asOf: '2026-11-13T00:00:00Z' })
    expect(result.state).toBe('succeeded')
    if (result.state !== 'succeeded') return
    expect(result.nextCursor).toBeUndefined()
  })

  it('drops one malformed release instead of failing the whole page', () => {
    const result = parseNarwhalCalendarPage(page([entry({ release_id: '' }), entry({ release_id: 'ok' })]), { asOf: '2026-11-13T00:00:00Z' })
    if (result.state !== 'succeeded') throw new Error('expected success')
    expect(result.releases.map(release => release.releaseId)).toEqual(['ok'])
  })

  it('passes next_cursor through when present and leaves it out when absent', () => {
    const withCursor = parseNarwhalCalendarPage(page([], 'cursor-2'), { asOf: '2026-11-13T00:00:00Z' })
    const without = parseNarwhalCalendarPage(page([]), { asOf: '2026-11-13T00:00:00Z' })
    if (withCursor.state !== 'succeeded' || without.state !== 'succeeded') throw new Error('expected success')
    expect(withCursor.nextCursor).toBe('cursor-2')
    expect(without.nextCursor).toBeUndefined()
  })

  it('converts the release instant to the reader time zone for the day, without truncating the instant', () => {
    const result = parseNarwhalCalendarPage(page([entry({ at: '2026-11-13T23:30:00Z' })]), { asOf: '2026-11-13T00:00:00Z', timeZone: 'Asia/Shanghai' })
    if (result.state !== 'succeeded') throw new Error('expected success')
    // 时刻统一成带毫秒的规范形式：存储层只认这一种，秒级差异会让同一条发布在库里出现两个时刻。
    expect(result.releases[0]!.at).toBe('2026-11-13T23:30:00.000Z')
    expect(result.releases[0]!.eventDate).toBe('2026-11-14')
  })
})
