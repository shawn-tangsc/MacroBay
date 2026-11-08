import { describe, expect, it, vi } from 'vitest'

import type { NotificationSubmitRequest } from '@platform/notifications/contracts/notificationContracts'

import type { CalendarReminderSettings } from '../../../contracts/calendarEventReminder'
import { formatCalendarReminderInstant, renderCalendarReminderSentence } from './calendarEventReminderCopy'
import {
  CALENDAR_EVENT_REMINDER_INTERVAL_MS,
  CALENDAR_EVENT_REMINDER_JOB_ID,
  registerCalendarEventReminderJob,
  type CalendarEventReminderDeps
} from './calendarEventReminderJob'
import type { CalendarReminderEvent } from './calendarEventReminderScan'

const NOW = '2026-11-07T12:00:00.000Z'

function settings(overrides: Partial<CalendarReminderSettings> = {}): CalendarReminderSettings {
  return { enabled: true, leadMinutes: 60, importance: ['high'], ...overrides }
}

function event(overrides: Partial<CalendarReminderEvent> = {}): CalendarReminderEvent {
  return { eventKey: 'US.CPI.RELEASE.2026-M11', title: 'CPI', scheduledAt: '2026-11-07T12:20:00.000Z', importance: 'high', ...overrides }
}

function harness(input: Readonly<{
  settings?: CalendarReminderSettings
  events?: readonly CalendarReminderEvent[]
  timeZone?: string
}> = {}) {
  const setSchedule = vi.fn()
  const removeSchedule = vi.fn()
  const registerHandler = vi.fn()
  const submit = vi.fn(async (_request: NotificationSubmitRequest) => ({ kind: 'accepted' }))
  const log = vi.fn()
  const deps: CalendarEventReminderDeps = {
    readSettings: () => input.settings ?? settings(),
    readEvents: () => input.events ?? [event()],
    submit: submit as never,
    now: () => NOW,
    timeZone: () => input.timeZone ?? 'Asia/Shanghai',
    log
  }
  const jobRuntime = { registerHandler, setSchedule, removeSchedule }
  const job = registerCalendarEventReminderJob(jobRuntime as never, deps)
  return { job, submit, log, setSchedule, removeSchedule, registerHandler }
}

describe('calendar reminder job', () => {
  it('re-arms itself on start-up when the reader has it on', () => {
    // 「关掉应用再开，提醒仍然会来」：注册发生在每次启动，开着就必须排上。
    const { setSchedule, removeSchedule } = harness()
    expect(setSchedule).toHaveBeenCalledTimes(1)
    expect(setSchedule.mock.calls[0]?.[0]).toMatchObject({
      id: CALENDAR_EVENT_REMINDER_JOB_ID,
      trigger: { kind: 'interval', intervalMs: CALENDAR_EVENT_REMINDER_INTERVAL_MS }
    })
    expect(removeSchedule).not.toHaveBeenCalled()
  })

  it('leaves no schedule behind while it is off, and submits nothing', async () => {
    const { job, submit, removeSchedule } = harness({ settings: settings({ enabled: false }) })
    expect(removeSchedule).toHaveBeenCalledWith(CALENDAR_EVENT_REMINDER_JOB_ID)
    const result = await job.runOnce()
    expect(result.submitted).toEqual([])
    expect(submit).not.toHaveBeenCalled()
  })

  it('submits one request per event with the key the platform dedupes on', async () => {
    const { job, submit } = harness({
      events: [event({ eventKey: 'a' }), event({ eventKey: 'b', scheduledAt: '2026-11-07T12:40:00.000Z' })]
    })
    const result = await job.runOnce()
    expect(result.submitted).toHaveLength(2)
    expect(submit).toHaveBeenCalledTimes(2)
    expect(submit.mock.calls[0]?.[0]).toMatchObject({
      eventTypeId: 'market-intelligence.calendar.event-upcoming',
      dedupeVars: { builder: 'template', vars: { eventKey: 'a', scheduledAt: '2026-11-07T12:20:00.000Z' } },
      actions: []
    })
  })

  it('keeps the key stable across scans, so the same event is not reminded twice', async () => {
    // 稳定身份来自上游约束：`observationKey` 稳定 → 落库的 `eventKey` 是它的摘要 → 没有稳定身份
    // 的观察压根不入库。这条用例钉的就是这个前提：同一条事件扫两次，键必须相同；两条不同的事件
    // 键必须不同。哪天上游放宽了「缺身份也给键」，这里会先红。
    const first = harness({ events: [event({ eventKey: 'observation-1' })] })
    const second = harness({ events: [event({ eventKey: 'observation-1' })] })
    await first.job.runOnce()
    await second.job.runOnce()
    const varsOf = (submit: { mock: { calls: unknown[][] } }): unknown =>
      (submit.mock.calls[0]![0] as { dedupeVars?: { vars?: Record<string, string> } }).dedupeVars?.vars
    expect(varsOf(first.submit)).toEqual(varsOf(second.submit))

    const other = harness({ events: [event({ eventKey: 'observation-2' })] })
    await other.job.runOnce()
    expect(varsOf(other.submit)).not.toEqual(varsOf(first.submit))
  })

  it('writes "20 minutes" into the sentence, not the 60-minute lead', async () => {
    const { job, submit } = harness()
    await job.runOnce()
    const rendered = submit.mock.calls[0]![0].rendered!
    expect(rendered['zh-CN']!.title).toContain('20 分钟')
    expect(rendered['zh-CN']!.title).not.toContain('60 分钟')
    expect(rendered['en-US']!.title).toContain('20 min')
    // 两段句子都不许出现动作指令——手机上是纯文本，没有东西可点。
    for (const language of ['zh-CN', 'en-US'] as const) {
      expect(rendered[language]!.title).not.toMatch(/点开|查看|click to|open it/iu)
    }
  })

  it('shows the instant in the reader time zone without letting the zone decide anything', () => {
    const shanghai = formatCalendarReminderInstant('2026-11-07T12:20:00.000Z', 'zh-CN', 'Asia/Shanghai')
    const utc = formatCalendarReminderInstant('2026-11-07T12:20:00.000Z', 'zh-CN', 'UTC')
    expect(shanghai).not.toBe(utc)
    // 两个时区都还是「同一时刻」的两种显示：判断（还剩几分钟）来自候选，与这里无关。
    const sentence = renderCalendarReminderSentence({
      candidate: {
        eventKey: 'a', title: 'CPI', scheduledAt: '2026-11-07T12:20:00.000Z',
        importance: 'high', remainingMinutes: 20,
        dedupeKey: 'calendar-upcoming:a:2026-11-07T12:20:00.000Z'
      },
      timeZone: 'UTC'
    })
    expect(sentence['zh-CN']!.title).toContain('20 分钟')
    expect(sentence['en-US']!.body).toContain('High importance')
  })

  it('keeps going when one submission fails, so one bad event cannot silence the batch', async () => {
    const submit = vi.fn(async (_request: NotificationSubmitRequest) => ({ kind: 'accepted' }))
      .mockRejectedValueOnce(new Error('channel down'))
      .mockResolvedValueOnce({ kind: 'accepted' })
    const registerHandler = vi.fn()
    const job = registerCalendarEventReminderJob(
      { registerHandler, setSchedule: vi.fn(), removeSchedule: vi.fn() } as never,
      {
        readSettings: () => settings(),
        readEvents: () => [event({ eventKey: 'a' }), event({ eventKey: 'b' })],
        submit: submit as never,
        now: () => NOW,
        timeZone: () => 'UTC'
      }
    )
    const result = await job.runOnce()
    expect(submit).toHaveBeenCalledTimes(2)
    expect(result.submitted.map((candidate) => candidate.eventKey)).toEqual(['b'])
  })
})
