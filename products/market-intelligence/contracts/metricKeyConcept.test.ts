import { describe, expect, it } from 'vitest'

import { MACRO_INDICATOR_GROUPS, MACRO_INDICATOR_RETIRED_METRIC_KEYS } from '../service/intelligence/macro-calendar/macroIndicatorCardGroups'
import { metricConceptByMetricKey, metricConceptOf } from './metricKeyConcept'

/**
 * 「指标码 → 概念」这张表的**双向守卫**（Chief 2026-11-14 定）。
 *
 * 为什么双向：单向只能挡住「表里多出一个没人认的码」，挡不住「卡片行里新加了一个码、概念表忘了写」——
 * 后者会让盘口/标注按概念查不到它，表现是「有值却读不到」，而且不报错。两个方向都断，漏一个就红。
 *
 * 允许出现的码只有两种：12 张卡片行里的码，或退役表里的码。别处（例如只为某条读取链顺手加的码）
 * 不行——那说明它该先进卡片行或退役表，再进这张表。
 */
const cardKeys = MACRO_INDICATOR_GROUPS.flatMap((group) => group.rows.map((row) => row.metricKey))
const retiredKeys = MACRO_INDICATOR_RETIRED_METRIC_KEYS.map((row) => row.retiredMetricKey)
const registered = new Set<string>([...cardKeys, ...retiredKeys])

describe('metric key → concept table', () => {
  it('表里每个码都必须是卡片行或退役码，不许有第三个来源', () => {
    const orphans = Object.keys(metricConceptByMetricKey).filter((key) => !registered.has(key))
    expect(orphans, `这些码既不在卡片行也不在退役表里，概念表不该认得它们：\n${orphans.join('\n')}`).toEqual([])
  })

  it('卡片行与退役码必须每一个都在概念表里', () => {
    const missing = [...registered].filter((key) => metricConceptByMetricKey[key] === undefined)
    expect(missing, `这些码在卡片行/退役表里，却查不到概念——盘口与标注会按概念漏掉它们：\n${missing.join('\n')}`).toEqual([])
  })

  it('概念本身不含口径段：季调/未季调只能是同一概念的变体', () => {
    const dirty = Object.entries(metricConceptByMetricKey)
      .filter(([, concept]) => /\.(SA|NSA)\./.test(concept))
      .map(([key, concept]) => `${key} → ${concept}`)
    expect(dirty, `概念里还留着口径段，变体不会被合并：\n${dirty.join('\n')}`).toEqual([])
  })

  it('退役码与它的当前码必须落在同一个概念上', () => {
    const drift = MACRO_INDICATOR_RETIRED_METRIC_KEYS
      .filter((row) => metricConceptOf(row.retiredMetricKey) !== metricConceptOf(row.currentMetricKey))
      .map((row) => `${row.retiredMetricKey} → ${metricConceptOf(row.retiredMetricKey)}，` +
        `${row.currentMetricKey} → ${metricConceptOf(row.currentMetricKey)}`)
    expect(drift, `退役关系与概念表打架：\n${drift.join('\n')}`).toEqual([])
  })

  it('未知码自成概念，不抛错也不猜到一个相近的概念', () => {
    // 源内身份与事件码不在这张表里：它们不是指标，按「自己就是一个概念」处理。
    expect(metricConceptOf('evt.fomc')).toBe('evt.fomc')
    expect(metricConceptOf('US.MADE_UP.NONE.YOY')).toBe('US.MADE_UP.NONE.YOY')
  })
})
