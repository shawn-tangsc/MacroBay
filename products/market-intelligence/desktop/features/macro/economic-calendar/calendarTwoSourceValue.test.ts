import { describe, expect, it } from 'vitest'

import { calendarTwoSourceValue, type CalendarSourceValue } from './calendarTwoSourceValue'

/**
 * 一个字段、两个来源各给了一个值时显示什么——**用户 2026-11-16 拍板**的口径。
 *
 * 钉三件事：
 * 1. 主源 = **观测时刻更晚**的那一个（不是谁先声明、也不是谁后写进来）；
 * 2. **同刻按源注册表声明顺序**（产品 `r38` 口径），而且连跑两次结果相同——否则主源每次刷新都跳；
 * 3. 值不同就并列标「两源不一致」，值相同不加标，只有一方给就标「备用来源」；**空串算没给**。
 */
const narwhal = (value: string, observedAt: string): CalendarSourceValue => ({ source: 'narwhal', value, observedAt })
const router = (value: string, observedAt: string): CalendarSourceValue => ({ source: '0xrouter', value, observedAt })
/** 注册表里 narwhal 先声明（真实注册表就是这个顺序）。 */
const ORDER = ['narwhal', '0xrouter'] as const

describe('two sources, one field', () => {
  it('makes the fresher observation the primary, whichever source declared first', () => {
    // 帝国大厦那条的形状：Narwhal 三天前的 10，0xRouter 发布前六分钟的 18。
    const view = calendarTwoSourceValue([
      narwhal('10', '2026-11-13T23:21:33.876Z'),
      router('18', '2026-11-16T13:24:19.608Z')
    ], ORDER)
    expect(view?.kind).toBe('disagree')
    expect(view).toMatchObject({ kind: 'disagree', primary: { source: '0xrouter', value: '18' }, backup: { source: 'narwhal', value: '10' } })
  })

  it('keeps the primary stable when the observation instants are equal: registry declaration order', () => {
    const same = '2026-11-16T13:24:19.608Z'
    const once = calendarTwoSourceValue([narwhal('10', same), router('18', same)], ORDER)
    expect(once).toMatchObject({ kind: 'disagree', primary: { source: 'narwhal', value: '10' } })
    // 连跑两次同一结果：主源不许随刷新跳。
    expect(calendarTwoSourceValue([router('18', same), narwhal('10', same)], ORDER)).toEqual(once)
    // 注册表换个声明顺序，主源就跟着换——证明判据是「声明顺序」，不是字典序。
    expect(calendarTwoSourceValue([narwhal('10', same), router('18', same)], ['0xrouter', 'narwhal']))
      .toMatchObject({ kind: 'disagree', primary: { source: '0xrouter', value: '18' } })
  })

  it('shows one value and no marker when the two agree', () => {
    expect(calendarTwoSourceValue([
      narwhal('18', '2026-11-16T13:24:19.608Z'), router('18', '2026-11-16T13:30:00.000Z')
    ], ORDER)).toEqual({ kind: 'single', value: '18', source: '0xrouter', fromBackup: false })
  })

  it('falls back to the other source when one side gave nothing — and says so', () => {
    // Narwhal 的美国 CPI 预期值是空串：那是「没给」，不是一个值。
    const view = calendarTwoSourceValue([
      narwhal('', '2026-11-16T13:24:19.608Z'), router('18', '2026-11-16T13:00:00.000Z')
    ], ORDER)
    expect(view).toEqual({ kind: 'single', value: '18', source: '0xrouter', fromBackup: true })
  })

  it('gives nothing when both sides gave nothing (the caller prints 未提供)', () => {
    expect(calendarTwoSourceValue([narwhal('', '2026-11-16T00:00:00.000Z'), router(' ', '2026-11-16T00:00:00.000Z')], ORDER))
      .toBeUndefined()
    expect(calendarTwoSourceValue([], ORDER)).toBeUndefined()
  })

  it('marks a lone primary value as primary, not as a backup', () => {
    expect(calendarTwoSourceValue([narwhal('18', '2026-11-16T13:24:19.608Z')], ORDER))
      .toEqual({ kind: 'single', value: '18', source: 'narwhal', fromBackup: false })
  })
})
