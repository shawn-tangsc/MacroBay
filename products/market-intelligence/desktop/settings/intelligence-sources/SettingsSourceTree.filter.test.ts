import { describe, expect, it } from 'vitest'

import { sourceMatchesFilter } from './SettingsSourceTree'

/**
 * 「舆情」筛选按**用途**判，不按面板（用户 2026-11-10）。
 *
 * `panels` 是面板路由，只由 `purposes` 的 dashboard / calendar 映射出来；`sentiment` 没有对应面板，
 * 所以按 `panels` 永远筛不出舆情源。把它塞进 `panels` 又会污染别处按 panels 做的判断——所以这里读 `purposes`。
 */
const source = (overrides: Partial<{ panels: readonly string[]; purposes: readonly string[]; visibility: string; kind: string }> = {}) => ({
  panels: [],
  purposes: [],
  visibility: 'visible',
  kind: 'feed',
  ...overrides
})

describe('the sentiment filter follows purposes, not panels', () => {
  it('matches a source that declares the sentiment purpose', () => {
    // 真源：`coindesk-rss` 在 providerRegistry 里是 purposes: ['dashboard','briefing','sentiment']。
    expect(sourceMatchesFilter(source({ panels: ['dashboard'], purposes: ['dashboard', 'briefing', 'sentiment'] }), 'sentiment')).toBe(true)
  })

  it('does not match a source that only feeds the dashboard', () => {
    expect(sourceMatchesFilter(source({ panels: ['dashboard'], purposes: ['dashboard', 'briefing'] }), 'sentiment')).toBe(false)
  })

  it('keeps the panel filters on panels: dashboard is a route, not a purpose', () => {
    expect(sourceMatchesFilter(source({ panels: ['dashboard'], purposes: ['dashboard'] }), 'dashboard')).toBe(true)
    expect(sourceMatchesFilter(source({ panels: [], purposes: ['sentiment'] }), 'dashboard')).toBe(false)
    expect(sourceMatchesFilter(source({ purposes: ['sentiment'] }), 'all')).toBe(true)
  })
})
