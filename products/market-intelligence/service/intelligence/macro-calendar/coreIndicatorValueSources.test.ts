import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  blsCoveredMetricKeys,
  coreIndicatorKeysMissingFromCards,
  coreIndicatorMetricKeys,
  coreIndicatorOfficialLegExceptions,
  coreIndicatorValueSourceRows,
  metricsDeclaredWithoutOfficialLeg,
  metricsWithoutOfficialLeg,
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
    // PCE 年率两条按**季调**码取（BEA 公布口径就是季调）；NSA 两个码保留但不再装季调值。
    expect(describeOf('US.CORE_PCE.SA.YOY'))
      .toEqual(['narwhal:current-value', 'fred-rates-liquidity:official-yoy'])
    expect(describeOf('US.PCE.SA.YOY'))
      .toEqual(['narwhal:current-value', 'fred-rates-liquidity:official-yoy'])
    // NSA 码只剩「未季调年率」这个身份，没有官方腿，进例外清单。
    expect(describeOf('US.CORE_PCE.NSA.YOY')).toEqual([])
    // 新增就业的官方腿是 BLS，不是 FRED——两条腿别混。
    expect(describeOf('US.NONFARM.SA.CHANGE')).toEqual(['narwhal:current-value', 'bls:official-change'])
    // role 由策略表的 `unit` 定：万人当量是「净变化」，失业率是「水平」。
    expect(describeOf('US.UNEMPLOYMENT.SA.RATE')).toEqual(['narwhal:current-value', 'bls:official-level'])
    // 时薪月率有三条腿，官方那两条口径是「月率」（`pch` / `monthly percent change`），不是同比。
    expect(describeOf('US.AHE.SA.MOM')).toEqual([
      'narwhal:current-value', 'fred-rates-liquidity:official-mom', 'bls:official-mom'
    ])
    // 月率其余三格：FRED 一条官方腿，取 `pch`。
    expect(describeOf('US.CPI.SA.MOM')).toEqual(['narwhal:current-value', 'fred-rates-liquidity:official-mom'])
    expect(describeOf('US.CORE_CPI.SA.MOM')).toEqual(['narwhal:current-value', 'fred-rates-liquidity:official-mom'])
    expect(describeOf('US.PCE.SA.MOM')).toEqual(['narwhal:current-value', 'fred-rates-liquidity:official-mom'])
    expect(describeOf('US.CORE_PCE.SA.MOM')).toEqual(['narwhal:current-value', 'fred-rates-liquidity:official-mom'])
    // 时薪年率用未季调序列（CEU…，2026-11-14 在 FRED 上确证），不是拿季调的 3.1% 顶。
    expect(describeOf('US.AHE.NSA.YOY')).toEqual(['narwhal:current-value', 'fred-rates-liquidity:official-yoy'])
  })

  /**
   * 不变量（Chief 2026-11-14）：12 个指标每一个都必须至少有一条官方腿，
   * 例外只能出现在写明原因的单子里。这条能红的真情况：扩腿时漏掉一格、或有人删了例外单子里那条原因。
   */
  it('leaves no metric without an official leg, except the ones the list explains', () => {
    // 12 张卡行现在每一格都有官方腿；例外里那两个 NSA 码是**留给未季调来源的身份**，不在 12 行里。
    expect([...metricsWithoutOfficialLeg()].sort()).toEqual([])
    expect([...metricsDeclaredWithoutOfficialLeg()].sort()).toEqual(['US.CORE_PCE.NSA.YOY', 'US.PCE.NSA.YOY'])
    for (const exception of coreIndicatorOfficialLegExceptions) {
      expect(exception.reason.length, exception.metricKey).toBeGreaterThan(8)
      // 例外里不许留序列号猜测值：留着就等于给了下一个人一个「接上它」的理由。
      for (const policy of Object.values(fredIndicatorYoYPolicy.seriesByMetricKey)) {
        expect(exception.reason, exception.metricKey).not.toContain(policy.seriesId)
      }
    }
    // 例外单子里的码**必须在 12 行之外**：在 12 行里却没有官方腿，是漏了腿而不是记例外。
    for (const exception of coreIndicatorOfficialLegExceptions) {
      expect(MACRO_INDICATOR_GROUP_METRIC_KEYS as readonly string[], exception.metricKey).not.toContain(exception.metricKey)
    }
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
      ...coreIndicatorMetricKeys,
      // 例外单子里的码是产品决定（带原因），允许写在这里；腿的清单仍然不许抄。
      ...coreIndicatorOfficialLegExceptions.map((entry) => entry.metricKey)
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
