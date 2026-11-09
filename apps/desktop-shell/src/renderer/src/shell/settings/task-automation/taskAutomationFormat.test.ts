import { describe, expect, it } from 'vitest'

import { platformText } from '../../../i18n/platformText'
import {
  buildPolicyFacts,
  formatIntervalSchedule,
  formatJobSchedule,
  formatTaskSchedule,
  formatTimestamp
} from './taskAutomationFormat'

const zh = platformText['zh-CN'].taskAutomation
const en = platformText['en-US'].taskAutomation

describe('taskAutomationFormat', () => {
  it('formats interval schedules in the largest whole unit with localized units', () => {
    expect(formatIntervalSchedule(60_000, zh)).toBe('每 1 分钟')
    expect(formatIntervalSchedule(15 * 60_000, zh)).toBe('每 15 分钟')
    expect(formatIntervalSchedule(3_600_000, zh)).toBe('每 1 小时')
    expect(formatIntervalSchedule(90_000, zh)).toBe('每 90 秒')
    expect(formatIntervalSchedule(15 * 60_000, en)).toBe('Every 15 min')
    expect(formatIntervalSchedule(3_600_000, en)).toBe('Every 1 h')
  })

  it('formats cron, once, manual, startup, and event schedules', () => {
    expect(formatTaskSchedule({ kind: 'cron', expr: '0 9 * * *' }, zh, 'zh-CN', 'UTC')).toBe('Cron 0 9 * * *')
    expect(formatTaskSchedule({ kind: 'cron', expr: '0 9 * * *', timezone: 'Asia/Shanghai' }, en, 'en-US', 'UTC'))
      .toBe('Cron 0 9 * * * · Asia/Shanghai')

    const onceAt = new Date('2026-07-17T01:30:00.000Z').getTime()
    const onceTime = formatTimestamp('2026-07-17T01:30:00.000Z', 'zh-CN', 'UTC')
    expect(formatTaskSchedule({ kind: 'once', at: onceAt }, zh, 'zh-CN', 'UTC')).toBe(zh.schedule.onceAt(onceTime ?? ''))

    expect(formatJobSchedule({ kind: 'manual' }, zh, 'zh-CN')).toBe('手动')
    expect(formatJobSchedule({ kind: 'startup' }, zh, 'zh-CN')).toBe('启动时')
    expect(formatJobSchedule({ kind: 'event', topic: 'agent.session.created' }, zh, 'zh-CN'))
      .toBe('事件 · agent.session.created')
    expect(formatJobSchedule({ kind: 'interval', intervalMs: 900_000, anchor: 'lastComplete' }, zh, 'zh-CN'))
      .toBe('每 15 分钟')
  })

  it('formats null timestamps as null so callers can render the localized empty value', () => {
    expect(formatTimestamp(null, 'zh-CN')).toBeNull()
    expect(formatTimestamp('not-a-date', 'zh-CN')).toBeNull()
    expect(formatTimestamp('2026-07-17T09:05:00.000Z', 'en-US', 'UTC')).toContain('07/17')
  })

  /**
   * 时刻按读者时区显示：同一个瞬间在两个时区下必须是两个钟点。
   * 一次性调度的钟点也是触发瞬间，所以跟读者时区走；cron 的「表达式 · 定义时区」不是瞬间，不跟。
   */
  it('renders a moment in the reader zone, and a once-schedule follows that zone', () => {
    const instant = '2026-07-18T01:00:00.000Z'
    expect(formatTimestamp(instant, 'zh-CN', 'Asia/Shanghai')).toBe('07/18 09:00')
    expect(formatTimestamp(instant, 'zh-CN', 'America/New_York')).toBe('07/17 21:00')
    expect(formatTaskSchedule({ kind: 'once', at: Date.parse(instant) }, zh, 'zh-CN', 'America/New_York'))
      .toBe(zh.schedule.onceAt('07/17 21:00'))
    // 定义不是瞬间：cron 即使有定义时区，也照原样显示那个时区，不换算成读者时区。
    expect(formatTaskSchedule({ kind: 'cron', expr: '0 9 * * *', timezone: 'Asia/Shanghai' }, zh, 'zh-CN', 'America/New_York'))
      .toBe('Cron 0 9 * * * · Asia/Shanghai')
  })

  it('builds the three policy facts from the real preset values with units', () => {
    const facts = buildPolicyFacts(
      { maxActiveTasksPerAgent: 10, minimumRecurringIntervalMs: 15 * 60_000, maximumTimeoutMinutes: 30, maxChannelsPerTask: 5 },
      zh,
      'zh-CN'
    )

    expect(facts.map((fact) => fact.label)).toEqual(['并发上限', '最短调度间隔', '单次运行超时'])
    expect(facts.map((fact) => fact.value)).toEqual(['10 个任务并行', '每 15 分钟', '30 分钟'])
  })
})
