import { describe, expect, it, vi } from 'vitest'

import { readCalendarFreshnessFromJobRuns } from './marketCalendarFreshnessFromJobs'

/**
 * **判定现场必须留下结构化一行**（2026-11-16，用户要求「埋点也要加上」）。
 *
 * 判据不是「日志存在」，而是：**只看这一行就能说出为什么判过期**——写入时刻、判定时刻、
 * 年龄、阈值、结论。今晚每次都要翻代码推这几个数，这行就是为了不再翻。
 *
 * 另一条同样重要：**每版只打一次**。读取器一次生成里会被问多次，刷屏的日志等于没用。
 */
describe('判定现场埋点', () => {
  it('判过期时，这一行写明写入时刻/年龄/阈值/结论；同一次生成只打一次', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const input = {
        lastWrittenAt: '2026-11-13T13:20:07.915Z',   // 今晚那次的真实旧源时刻
        asOf: '2026-11-16T09:30:00.000Z'
      }
      readCalendarFreshnessFromJobRuns(input)
      readCalendarFreshnessFromJobRuns(input)        // 同一次生成的第二次问：不许再打
      const lines = warn.mock.calls.map(([line]) => String(line)).filter((line) => line.includes('macro-calendar.freshness'))
      expect(lines).toHaveLength(1)
      const record = JSON.parse(lines[0]!) as Record<string, unknown>
      expect(record).toMatchObject({
        lastWrittenAt: '2026-11-13T13:20:07.915Z', asOf: '2026-11-16T09:30:00.000Z',
        thresholdMinutes: 120, verdict: 'stale'
      })
      // ≈68 小时（4089.9 分钟）：从 11-13T13:20 到 11-16T09:30 的实际差 → 一眼看出为什么判过期
      expect(record.ageMinutes).toBeCloseTo(4089.9, 0)
      // 安全四项：不打印凭据/URL/来源名
      expect(lines[0]).not.toContain('http')
      expect(lines[0]).not.toContain('key')
    } finally { warn.mockRestore() }
  })
})
