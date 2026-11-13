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
import { macroCalendarReleaseValueMappings } from './macroCalendarReleaseValueMappingPolicy'
import { MACRO_INDICATOR_GROUP_METRIC_KEYS } from './macroIndicatorCardGroups'

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

    // 两条官方腿：FRED 给同比，BLS 也给这条发布（`releaseLabel` 写着的），两条都得出现、不许合并。
    expect(describeOf('US.CPI.NSA.YOY'))
      .toEqual(['narwhal:current-value', 'fred-rates-liquidity:official-yoy', 'bls:official-yoy'])
    expect(describeOf('US.CORE_CPI.NSA.YOY'))
      .toEqual(['narwhal:current-value', 'fred-rates-liquidity:official-yoy', 'bls:official-yoy'])
    expect(describeOf('US.CORE_PCE.NSA.YOY'))
      .toEqual(['narwhal:current-value', 'fred-rates-liquidity:official-yoy'])
    // 新增就业的官方腿是 BLS，不是 FRED——两条腿别混。
    expect(describeOf('US.NONFARM.SA.CHANGE')).toEqual(['narwhal:current-value', 'bls:official-change'])
    // role 由策略表的 `unit` 定：万人当量是「净变化」，失业率是「水平」，时薪月率是「月率」。
    expect(describeOf('US.UNEMPLOYMENT.SA.RATE')).toEqual(['narwhal:current-value', 'bls:official-level'])
    expect(describeOf('US.AHE.SA.MOM')).toEqual(['narwhal:current-value', 'bls:official-mom'])
  })

  it('keeps the menu list pointing at the same metric keys as the cards', () => {
    expect(coreIndicatorKeysMissingFromCards()).toEqual([])
  })

  /**
   * BLS 覆盖不再手抄（2026-11-14 Chief 核出的缺陷）：这里**自己从策略表筛一遍**，
   * 不调用被测的派生函数——否则两边都读同一份实现，守卫就是白跑。
   *
   * 这条能红的两种真情况：① 有人把 `blsCoveredMetricKeys` 改回手写清单、漏掉三条；
   * ② 派生时的 `releaseLabel` 字面量写错（比如少写 ` official release`），集合会少人。
   */
  it('derives the BLS leg from the release mapping policy, so no metric is left out', () => {
    const fromPolicy = macroCalendarReleaseValueMappings
      .filter((mapping) => mapping.releaseLabel === 'BLS official release')
      .map((mapping) => mapping.metricKey)
      .sort()
    expect(fromPolicy).toHaveLength(5)
    expect([...blsCoveredMetricKeys].sort()).toEqual(fromPolicy)
    // 少登记的那三个是这次的真缺陷：单独点名，免得集合整体对、这一项又漏回去。
    expect(fromPolicy).toEqual([
      'US.AHE.SA.MOM', 'US.CORE_CPI.NSA.YOY', 'US.CPI.NSA.YOY',
      'US.NONFARM.SA.CHANGE', 'US.UNEMPLOYMENT.SA.RATE'
    ])
  })

  /** 每条 BLS 腿都必须落在 12 个核心指标码里：策略表加了别的码，页面也不该凭空多一行。 */
  it('keeps every BLS leg inside the twelve core indicator codes', () => {
    const extras = blsCoveredMetricKeys.filter((key) => !(MACRO_INDICATOR_GROUP_METRIC_KEYS as readonly string[]).includes(key))
    expect(extras).toEqual([])
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
   * 源码级守卫：本文件里**不许出现 BLS 覆盖的那几个指标码**（2026-11-14 起它是派生的），
   * 也不许出现 Narwhal / FRED 清单的抄件。允许的字面量只剩**产品定的四项核心指标**。
   */
  it('keeps the module free of a second copy of the Narwhal, FRED or BLS legs', () => {
    const source = readFileSync(join(process.cwd(),
      'products/market-intelligence/service/intelligence/macro-calendar/coreIndicatorValueSources.ts'), 'utf8')
    const literals = source.match(/'US\.[A-Z0-9_.]+'/g) ?? []
    // 允许的字面量只剩**产品定的四项核心指标**（2026-11-14 定，不是从卡片行键派生——派生会产出 11 项、7 张空卡）。
    const allowed = new Set([
      'US.CPI.NSA.YOY', 'US.CORE_CPI.NSA.YOY', 'US.CORE_PCE.NSA.YOY', 'US.NONFARM.SA.CHANGE'
    ])
    const extra = literals.filter((literal) => !allowed.has(literal.replace(/'/g, '')))
    expect(extra).toEqual([])
    // BLS 那几条曾经是这里的手抄清单：除产品定的四项之外，一条都不许留，漏一次就是设置页少三行源。
    for (const key of blsCoveredMetricKeys) {
      if (allowed.has(key)) continue
      expect(source, key).not.toContain(`'${key}'`)
    }
  })
})
