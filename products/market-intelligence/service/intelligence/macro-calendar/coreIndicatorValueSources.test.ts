import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  blsCoveredMetricKeys,
  coreIndicatorKeysMissingFromCards,
  coreIndicatorMetricKeys,
  coreIndicatorValueSourceRows,
  valueSourcesForMetric
} from './coreIndicatorValueSources'
import { fredIndicatorYoYPolicy } from './fredIndicatorYoY'

/**
 * 「指标 → 取值源」只有一处派生（Chief 2026-11-14）。
 *
 * 三条腿各有唯一出处：Narwhal 走 measure 映射、FRED 走同比序列映射、BLS 是新常量。
 * 这里钉四件事：四项的源与口径、菜单键与卡片键同源、BLS 只覆盖两条、以及**源码里不许再抄第二条腿**。
 */
describe('core indicator value sources', () => {
  it('gives each metric its data-provider leg plus the right official leg', () => {
    const describeOf = (metricKey: string) =>
      valueSourcesForMetric(metricKey).map((source) => `${source.providerId}:${source.role}`)

    expect(describeOf('US.CPI.NSA.YOY')).toEqual(['narwhal:current-value', 'fred-rates-liquidity:official-yoy'])
    expect(describeOf('US.CORE_CPI.NSA.YOY')).toEqual(['narwhal:current-value', 'fred-rates-liquidity:official-yoy'])
    expect(describeOf('US.CORE_PCE.NSA.YOY')).toEqual(['narwhal:current-value', 'fred-rates-liquidity:official-yoy'])
    // 新增就业的官方腿是 BLS，不是 FRED——两条腿别混。
    expect(describeOf('US.NONFARM.SA.CHANGE')).toEqual(['narwhal:current-value', 'bls:official-change'])
  })

  it('keeps the menu list pointing at the same metric keys as the cards', () => {
    expect(coreIndicatorKeysMissingFromCards()).toEqual([])
  })

  it('lets BLS cover exactly the two indicators it actually publishes', () => {
    expect([...blsCoveredMetricKeys].sort()).toEqual(['US.NONFARM.SA.CHANGE', 'US.UNEMPLOYMENT.SA.RATE'])
  })

  it('derives the FRED leg from the series map instead of restating it', () => {
    const fredRows = coreIndicatorValueSourceRows()
      .filter((row) => row.source.providerId === 'fred-rates-liquidity')
      .map((row) => row.metricKey)
      .sort()
    const seriesKeys = Object.keys(fredIndicatorYoYPolicy.seriesByMetricKey)
      .filter((key) => (coreIndicatorMetricKeys as readonly string[]).includes(key))
      .sort()
    expect(fredRows).toEqual(seriesKeys)
  })

  /**
   * 源码级守卫：本文件里除了 BLS 那两条，**不许出现第二个指标键字面量**。
   * 有人若把 Narwhal 或 FRED 的清单抄进来，这条就红——那正是「同一事实两处写」。
   */
  it('keeps the module free of a second copy of the Narwhal or FRED legs', () => {
    const source = readFileSync(join(process.cwd(),
      'products/market-intelligence/service/intelligence/macro-calendar/coreIndicatorValueSources.ts'), 'utf8')
    const literals = source.match(/'US\.[A-Z0-9_.]+'/g) ?? []
    const allowed = new Set(['US.NONFARM.SA.CHANGE', 'US.UNEMPLOYMENT.SA.RATE'])
    const extra = literals.filter((literal) => !allowed.has(literal.replace(/'/g, '')))
    expect(extra).toEqual([])
  })
})
