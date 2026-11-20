import { describe, expect, it } from 'vitest'

import { readEventMetricKeys } from './calendarEventMetricKeys'

/**
 * `measureKeys` 语义变更后的唯一解析入口（架构师 2026-11-21 第 2 条）。
 *
 * 旧行（长度 > 1）只有主测度可以读值；其余码一律「未提供」——
 * 红证：把 `readableKeys` 改回 `keys`，下面第二条立刻红（按失业率取到了非农那份值）。
 */
describe('事件行的指标键解析', () => {
  it('新行：只有一个码，legacy=false，可读就是它自己', () => {
    const reading = readEventMetricKeys({ measureKeys: ['US.NONFARM.SA.CHANGE'] })
    expect(reading).toEqual({
      keys: ['US.NONFARM.SA.CHANGE'], legacy: false, readableKeys: ['US.NONFARM.SA.CHANGE']
    })
  })

  it('旧行：一行两个码，只有主测度可以读值，另一个「未提供」', () => {
    const reading = readEventMetricKeys({
      measureKeys: ['US.NONFARM.SA.CHANGE', 'US.UNEMPLOYMENT.SA.RATE'],
      primaryMetricKey: 'US.NONFARM.SA.CHANGE'
    })
    expect(reading.legacy).toBe(true)
    // 键列表照旧两个（取名/判资格要用）
    expect(reading.keys).toEqual(['US.NONFARM.SA.CHANGE', 'US.UNEMPLOYMENT.SA.RATE'])
    // **取值窗口只有一个**：失业率拿不到这一行的值
    expect(reading.readableKeys).toEqual(['US.NONFARM.SA.CHANGE'])
    expect(reading.readableKeys).not.toContain('US.UNEMPLOYMENT.SA.RATE')
  })

  it('旧行且主测度解不出：一个码都不许读（宁可不显示，不许串值）', () => {
    const reading = readEventMetricKeys({
      measureKeys: ['US.CPI.SA.MOM', 'US.CPI.NSA.YOY']
    })
    expect(reading.legacy).toBe(true)
    expect(reading.readableKeys).toEqual([])
  })

  it('主测度不在键列表里（身份漂移）：不许读，避免读到别的行的值', () => {
    const reading = readEventMetricKeys({
      measureKeys: ['US.CPI.SA.MOM', 'US.CPI.NSA.YOY'],
      primaryMetricKey: 'US.CORE_CPI.SA.MOM'
    })
    expect(reading.readableKeys).toEqual([])
  })
})