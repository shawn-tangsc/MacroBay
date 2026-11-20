import { describe, expect, it } from 'vitest'

import type { JobScheduleView } from '@platform/jobs'

import { frequencyReadoutView, readSourceCadence } from './sourceCadence'

/**
 * 频率读数：**作业 → 源**的翻译，以及那一行该说什么（原型 2026-11-13）。
 *
 * 这份用例钉的是三件容易做错的事：
 * 1. 只认通用采集作业的 id（产品自有作业的源在界面上是「内置频率」，不读这一行）；
 * 2. 五种「不可判定」各自不同：读不到 ≠ 0 ≠ 从未 ≠ 未安排 ≠ 手动；
 * 3. 间隔与下次是两段独立事实——间隔有了，下次那一段怎么说是另一件事。
 */
function schedule(overrides: Readonly<Partial<JobScheduleView>> & Readonly<{ id: string }>): JobScheduleView {
  return {
    title: { text: 'Collect' } as never,
    owner: 'product',
    productId: 'market-intelligence',
    trigger: { kind: 'interval', intervalMs: 900_000, anchor: 'lastComplete' },
    registered: true,
    nextRunAt: null,
    lastRunAt: null,
    lastOutcome: 'never',
    lastRunStatus: null,
    lastDurationMs: null,
    lastErrorSummary: null,
    ...overrides
  }
}

const CADENCE = {
  intervalSeconds: 900,
  nextRunAt: '2026-12-01T06:30:00.000Z',
  lastRunAt: '2026-12-01T06:15:00.000Z'
} as const

describe('作业 → 源', () => {
  it('maps only the generic collect job ids, and carries the schedule facts through', () => {
    const bySource = readSourceCadence([
      schedule({ id: 'market-intelligence.collect:coindesk-rss', ...CADENCE, lastOutcome: 'success', lastRunStatus: 'completed' }),
      schedule({ id: 'market-intelligence.collect:coinbase-status', ...CADENCE, lastRunStatus: 'running' }),
      // 产品自有作业：源在界面上是「内置频率」，不该被读成这个源的排期。
      schedule({ id: 'market-intelligence.collect-macro-market' }),
      schedule({ id: 'unrelated.job' })
    ])
    expect(Object.keys(bySource).sort()).toEqual(['coinbase-status', 'coindesk-rss'])
    expect(bySource['coindesk-rss']).toEqual({
      registration: 'registered',
      mode: 'interval',
      intervalSeconds: 900,
      nextRunAt: CADENCE.nextRunAt,
      lastRunAt: CADENCE.lastRunAt,
      running: false
    })
    expect(bySource['coinbase-status']?.running).toBe(true)
  })

  it('rounds the interval to whole seconds and marks a non-interval trigger as unscheduled', () => {
    const bySource = readSourceCadence([
      schedule({ id: 'market-intelligence.collect:a', trigger: { kind: 'interval', intervalMs: 90_500, anchor: 'lastStart' } }),
      schedule({ id: 'market-intelligence.collect:b', trigger: { kind: 'manual' } })
    ])
    expect(bySource['a']?.intervalSeconds).toBe(91)
    expect(bySource['b']).toMatchObject({ mode: 'unscheduled', intervalSeconds: null })
  })
})

describe('这一行怎么读', () => {
  const base = { enabled: true, scheduleAvailable: true } as const

  it('未启用：不采集（不看排期，也不给数字）', () => {
    expect(frequencyReadoutView({ ...base, enabled: false })).toEqual({ kind: 'disabled' })
  })

  it('手动档：先于排期判，写「不自动采集」', () => {
    // 手动档底下本来就没有作业；即便投影里还留着旧定义，也按手动说。
    expect(frequencyReadoutView({ ...base, preset: 'manual', cadence: { registration: 'registered', mode: 'interval', ...CADENCE, running: false } }))
      .toEqual({ kind: 'manual' })
  })

  it('整批排期没读到：这一行不画（原因进 ⓘ），不把源画成「未安排」', () => {
    expect(frequencyReadoutView({ ...base, scheduleAvailable: false, cadence: undefined })).toEqual({ kind: 'unreadable' })
  })

  it('排期里没有这个源：未安排，且不显示间隔', () => {
    expect(frequencyReadoutView({ ...base, cadence: undefined })).toEqual({ kind: 'unscheduled' })
    expect(frequencyReadoutView({ ...base, cadence: { registration: 'absent', mode: 'unscheduled', intervalSeconds: null, nextRunAt: null, lastRunAt: null, running: false } }))
      .toEqual({ kind: 'unscheduled' })
  })

  it('有间隔就有第一段，第二段按事实分开', () => {
    const cadence = { registration: 'registered', mode: 'interval', ...CADENCE, running: false } as const
    expect(frequencyReadoutView({ ...base, cadence })).toEqual({
      kind: 'interval',
      intervalSeconds: 900,
      next: { kind: 'at', instant: CADENCE.nextRunAt }
    })
    // 正在采集：不给倒计时，跑完再给新时刻。
    expect(frequencyReadoutView({ ...base, cadence: { ...cadence, running: true } }))
      .toMatchObject({ kind: 'interval', next: { kind: 'running' } })
    // 从没跑过：尚未开始（不写「立即」、不编时刻）。
    expect(frequencyReadoutView({ ...base, cadence: { ...cadence, lastRunAt: null, nextRunAt: null } }))
      .toMatchObject({ kind: 'interval', next: { kind: 'notStarted' } })
    // 跑过但推不出下次：只有这一半读不到，间隔那一段照旧。
    expect(frequencyReadoutView({ ...base, cadence: { ...cadence, nextRunAt: null } }))
      .toMatchObject({ kind: 'interval', intervalSeconds: 900, next: { kind: 'unreadable' } })
  })
})
