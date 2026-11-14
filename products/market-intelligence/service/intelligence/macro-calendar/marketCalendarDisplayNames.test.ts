import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
  marketCalendarDisplayNameTally,
  marketCalendarDisplayTitle
} from './marketCalendarDisplayNames'
import {
  marketCalendarEventTypeDisplayNames,
  marketCalendarMetricDisplayNames
} from './marketCalendarDisplayNameTables'

describe('两张纯展示表', () => {
  // 39 = 原来的 37 + PCE 两个**季调**码（2026-11-14 补码；未季调那两个变体的名字仍在表里）。
  it('39 个 metric_key 全有中文名（本月 33 条 + 4 个头部指标 + 2 个季调 PCE），且没有重名', () => {
    const keys = Object.keys(marketCalendarMetricDisplayNames)
    expect(keys).toHaveLength(39)
    expect(new Set(Object.values(marketCalendarMetricDisplayNames)).size).toBe(keys.length)
    for (const name of Object.values(marketCalendarMetricDisplayNames)) {
      // 指标名，不是标题：不许把期间塞进名字里。
      expect(name).not.toMatch(/\(至\d|\(月\)|上月|本周/)
    }
  })

  it('14 个源类型名齐了，且一条个体名都没有', () => {
    const keys = Object.keys(marketCalendarEventTypeDisplayNames)
    expect(keys).toHaveLength(14)
    // 个体名（讲话人、具体会议）不许进这张表：源类型串里不会出现人名式的「姓 名」结构。
    for (const key of keys) expect(key).not.toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/)
    for (const name of Object.values(marketCalendarEventTypeDisplayNames)) {
      expect(name).not.toMatch(/主席|行长|先生|女士|新闻发布会：/)
    }
  })

  it('中文界面：指标名优先，其次类型名，未知回退英文并计数', () => {
    expect(marketCalendarDisplayTitle({ rawTitle: 'Consumer prices', eventNameKey: 'US.CORE_CPI.SA.MOM', locale: 'zh' }))
      .toBe('核心 CPI（月率）')
    // 四个头部指标之一：发布内按契约顺序取第一个有中文名的 measure。
    expect(marketCalendarDisplayTitle({ rawTitle: 'Consumer prices', eventNameKey: 'US.CORE_CPI.SA.MOM',
      measureKeys: ['US.CORE_CPI.SA.MOM', 'US.CPI.NSA.YOY', 'US.CORE_CPI.NSA.YOY'], locale: 'zh' }))
      .toBe('CPI 年率')
    expect(marketCalendarDisplayTitle({ rawTitle: 'Central bank speech', eventNameKey: undefined, locale: 'zh' }))
      .toBe('央行讲话')
    const before = marketCalendarDisplayNameTally().metricKeys
    expect(marketCalendarDisplayTitle({ rawTitle: 'Something new', eventNameKey: 'US.NOT.REGISTERED', locale: 'zh' }))
      .toBe('Something new')
    expect(marketCalendarDisplayNameTally().metricKeys).toBe(before + 1)
  })

  it('英文界面直接用源给的英文名，不查表', () => {
    expect(marketCalendarDisplayTitle({ rawTitle: 'Consumer prices', eventNameKey: 'US.CPI.NSA.YOY', locale: 'en' }))
      .toBe('Consumer prices')
  })

  it('标题用的优先顺序只读契约那一份，不另抄', () => {
    const source = readFileSync(new URL('./marketCalendarDisplayNames.ts', import.meta.url), 'utf8')
    // 顺序只许来自 `POLICY_PATH_EVENT_METRIC_PRIORITY_CONCEPTS`：这里出现那四个概念的字面量就是抄了第二份。
    for (const concept of ['US.CPI.YOY', 'US.CORE_CPI.YOY', 'US.NONFARM.CHANGE', 'US.CORE_PCE.YOY']) {
      expect(source).not.toContain(concept)
    }
    expect(source).toContain('POLICY_PATH_EVENT_METRIC_PRIORITY_CONCEPTS')
  })

  it('这两张表不许进身份与标注资格那条链——结构守卫', () => {
    const identity = readFileSync(new URL('./marketCalendarMetricIdentity.ts', import.meta.url), 'utf8')
    const pairing = readFileSync(new URL('./marketCalendarEventPairing.ts', import.meta.url), 'utf8')
    for (const source of [identity, pairing]) {
      expect(source).not.toContain('marketCalendarDisplayNames')
      expect(source).not.toContain('marketCalendarMetricDisplayNames')
      expect(source).not.toContain('marketCalendarEventTypeDisplayNames')
    }
  })
})
