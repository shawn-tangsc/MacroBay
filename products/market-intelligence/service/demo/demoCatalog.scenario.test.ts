import { describe, expect, it } from 'vitest'

import { loadSampleModeCatalog } from './demoCatalog'

/**
 * 对仓库里真实场景数据的守卫：录制数据被删、被改名、或 surfaces 与 fixture 脱节时先在这里红，
 * 而不是等打开看板才发现某个面板报「示例数据未覆盖」。
 */
describe('示例场景数据', () => {
  it('loads the shipped scenario for both languages with every surfaced method present', () => {
    for (const locale of ['zh-CN', 'en-US'] as const) {
      const catalog = loadSampleModeCatalog(locale)
      expect(catalog.problems).toEqual([])
      expect(catalog.scenarios.length).toBeGreaterThan(0)
      const scenario = catalog.scenarios[0]!
      expect(scenario.entries.size).toBeGreaterThanOrEqual(17)
      for (const method of scenario.surfaces) {
        expect(scenario.entries.has(method), `${locale} missing ${method}`).toBe(true)
      }
    }
  })

  it('keeps the three cross-asset ranges and the recorded scenario clock', () => {
    const scenario = loadSampleModeCatalog('en-US').scenarios[0]!
    const crossAsset = scenario.entries.get('intelligence.crossAsset.query')
    expect(Object.keys(crossAsset?.byRequest ?? {})).toEqual(expect.arrayContaining(['1h', '24h', '7d']))
    expect(scenario.meta.scenarioNow).toBe('2026-10-27T09:50:00.000Z')
  })
})
