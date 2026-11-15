import { describe, expect, it } from 'vitest'
import type { CalendarDayItem } from './economicCalendarDayModel'
import { calendarEventStatus } from './calendarEventStatusModel'

const now = '2026-09-11T04:00:00.000Z'
/** 签名要求读者时区（date-only 判定要用它）；这组夹具都写在 UTC，所以统一传 'UTC'。 */
const statusOf = (item: CalendarDayItem, at: string, attempt?: Parameters<typeof calendarEventStatus>[3]) =>
  calendarEventStatus(item, at, 'UTC', attempt)
const market = (overrides = {}) => ({ source: 'market', event: { eventType: 'economic-indicator', scheduledAt: now,
  providerActual: null, consensus: { displayValue: '3' }, providerPrevious: { displayValue: '2' }, ...overrides } }) as CalendarDayItem
const official = (overrides = {}) => ({ source: 'official', event: { scheduledDate: '2026-09-11', lifecycleState: 'scheduled', ...overrides } }) as CalendarDayItem
it('projects actual, future, missing-value and cancelled states without inferring numeric values', async () => {
  for (const displayValue of ['0', '-2', '1–3']) expect(statusOf(market({ providerActual: { displayValue } }), now)).toBe('data-received')
  expect(statusOf(market(), now)).toBe('awaiting-data')
  expect(statusOf(market({ scheduledAt: '2026-09-11T05:00:00.000Z', providerActual: { displayValue: '0' } }), now)).toBe('upcoming')
  expect(statusOf(official({ lifecycleState: 'cancelled' }), now)).toBe('cancelled')
})
it('生命周期读源给的 releaseStatus：市场路径的行也能显示「已取消」', () => {
  // 切到标准表后所有行都走市场那条路径；按 `source === 'official'` 分支推会让「已取消」永远不出现。
  expect(statusOf(market({ releaseStatus: 'cancelled' }), now)).toBe('cancelled')
  expect(statusOf(market({ releaseStatus: 'published', providerActual: { displayValue: '3' } }), now)).toBe('data-received')
  expect(statusOf(market({ releaseStatus: 'scheduled' }), now)).toBe('awaiting-data')
})

it('respects date-only evidence and does not treat elapsed speeches as missing economic data', async () => {
  expect(statusOf(official({ lifecycleState: 'released', actual: { displayValue: '0' } }), now)).toBe('data-received')
  expect(statusOf(official(), now)).toBe('time-pending')
  expect(statusOf(official({ scheduledDate: '2026-09-10' }), now)).toBe('awaiting-data')
  expect(statusOf(official({ scheduledDate: '2026-09-12', lifecycleState: 'released', actual: { displayValue: '2' } }), now)).toBe('upcoming')
  expect(statusOf(market({ eventType: 'central-bank-activity' }), now)).toBe('elapsed-unconfirmed')
})

it('keeps status precedence stable across time, value, and event kind', async () => {
  expect(statusOf(market({ scheduledAt: '2026-09-11T03:59:59.000Z', providerActual: null }), now)).toBe('awaiting-data')
  expect(statusOf(market({ scheduledAt: '2026-09-11T04:00:01.000Z', providerActual: { displayValue: '0' } }), now)).toBe('upcoming')
  expect(statusOf(market({ scheduledAt: '2026-09-10T04:00:00.000Z', eventType: 'financial-event', providerActual: { displayValue: '1' } }), now)).toBe('elapsed-unconfirmed')
  expect(statusOf(official({ scheduledDate: '2026-09-10', lifecycleState: 'released', actual: undefined, previous: { displayValue: '2' } }), now)).toBe('awaiting-data')
  expect(statusOf(official({ scheduledDate: '2026-09-12', lifecycleState: 'scheduled', actual: { displayValue: '0' } }), now)).toBe('upcoming')
})

it('separates "the source has not published yet" from "our collection was refused by the storage ceiling"', async () => {
  const pressure = { state: 'failed' as const, attemptedAt: '2026-09-11T03:30:00.000Z', failureCode: 'storage-pressure' as const, trigger: 'automatic' as const }
  // The newest stored batch predates the release and the newest attempt was refused on
  // capacity: nothing here proves the value, so the cell must not look empty.
  const beforeRelease = market({ sourceObservedAt: '2026-09-11T03:00:00.000Z' })
  expect(statusOf(beforeRelease, now, pressure)).toBe('storage-limited')
  // Observed after the release and still empty: the source itself published nothing yet.
  const afterRelease = market({ sourceObservedAt: '2026-09-11T04:30:00.000Z' })
  expect(statusOf(afterRelease, now, pressure)).toBe('awaiting-data')
  // Only the capacity verdict may be reported as a storage limit.
  for (const failureCode of ['storage-unavailable', 'response-unavailable', 'parse-unavailable', 'archive-unavailable'] as const) {
    expect(statusOf(beforeRelease, now, { ...pressure, failureCode })).toBe('awaiting-data')
  }
  expect(statusOf(beforeRelease, now, { state: 'succeeded', attemptedAt: now, trigger: 'automatic' })).toBe('awaiting-data')
  expect(statusOf(beforeRelease, now)).toBe('awaiting-data')
  // A value that did arrive is never relabelled by an older refusal.
  expect(statusOf(market({ sourceObservedAt: '2026-09-11T03:00:00.000Z', providerActual: { displayValue: '3' } }), now, pressure))
    .toBe('data-received')
  // The official route is not subject to the shared market-calendar ceiling.
  expect(statusOf(official({ scheduledDate: '2026-09-10' }), now, pressure)).toBe('awaiting-data')
})

/**
 * 五态口径（界面设计 2026-11-16）：发布后的两种新状态由**源给**，不由渲染层按时间推；
 * 过期后任何一处都不许出现「待发布」——这正是用户 11-10 CPI 那幕。
 */
describe('post-release states', () => {
  // 发布状态由**契约**定义，测试里也从它派生：契约扩枚举时这里跟着变，不另写一份字面量联合。
  type ReleaseStatus = NonNullable<Extract<CalendarDayItem, { source: 'market' }>['event']['releaseStatus']>
  const item = (releaseStatus: ReleaseStatus, actual?: { displayValue: string }): CalendarDayItem => ({
    key: `market-${releaseStatus}`, date: '2026-11-10', time: '21:30', source: 'market',
    event: {
      eventKey: `evt-${releaseStatus}`, title: 'CPI', eventType: 'economic-indicator', importance: 'high',
      scheduledAt: '2026-11-10T13:30:00.000Z', releaseStatus,
      ...(actual === undefined ? {} : { providerActual: actual }),
      consensus: null, providerPrevious: null, source: 'Narwhal',
      sourceObservedAt: '2026-11-10T13:20:00.000Z', coverage: 'observed-unverified'
    }
    // 夹具只关心状态判定需要的字段，其余按既有夹具惯例强转；类型来源仍是契约。
  }) as unknown as CalendarDayItem

  /**
   * `backfilling` / `missing` 的透传断言**等契约扩成五态后再加**：现在契约仍是四值联合，
   * 在这里写死这两个字面量就是「渲染侧自己另写一份联合」，那正是要避免的事。
   * 渲染模型已经认得这两档（`CalendarEventStatusPolicy.states` 含它们），缺的只是契约那一句。
   */
  it('keeps an overdue row out of 待发布 even before the five-state contract lands', () => {
    expect(calendarEventStatus(item('scheduled'), '2026-11-11T00:00:00.000Z', 'Asia/Shanghai')).toBe('awaiting-data')
  })

  it('never calls an overdue release 待发布: overdue without a value is 待补值', () => {
    const status = calendarEventStatus(item('scheduled'), '2026-11-11T00:00:00.000Z', 'Asia/Shanghai')
    expect(status).toBe('awaiting-data')
  })
})
