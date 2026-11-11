import { describe, expect, it } from 'vitest'

import { marketIntelligenceNotificationCopy } from '../../../../desktop/shared/i18n/text/notifications'
import { MARKET_INTELLIGENCE_NOTIFICATION_APPROVALS } from '../../../../contracts/notificationApprovals'
import { MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS } from '../../../../contracts/notificationEventKeys'
import {
  buildCalendarRefreshFailureRequest,
  calendarRefreshVariant,
  notifyCalendarRefreshFailed,
  readerCalendarDay,
  CALENDAR_REFRESH_NO_CODE_VARIANT
} from './marketCalendarRefreshNotifier'

const EVENT = MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS.calendarRefreshFailed
const occurredAt = '2026-11-11T08:30:00.000Z'

describe('calendar refresh failure notification', () => {
  // ① 失败一次 → 一条：事件是它自己，档位只有中心 + 桌面（没有手机），正文变体是失败码那一条。
  it('submits one centre-and-desktop notification, with no phone tier', () => {
    const request = buildCalendarRefreshFailureRequest({ providerId: 'macro-calendar-0xrouter', failureCode: 'response-unavailable', date: '2026-11-11', generation: 0 }, occurredAt)
    expect(request.eventTypeId).toBe(EVENT)
    expect(request.bodyVariant).toBe('response-unavailable')
    expect(request.dedupeVars).toEqual({ builder: 'template', vars: { providerId: 'macro-calendar-0xrouter', date: '2026-11-11', generation: '0' } })
    // 档位以批准表为准：中心 + 桌面，**不含** `channel`（手机）。
    expect(MARKET_INTELLIGENCE_NOTIFICATION_APPROVALS[EVENT]?.approvedDisruptionLevels).toEqual(['center', 'desktop'])
    expect(MARKET_INTELLIGENCE_NOTIFICATION_APPROVALS[EVENT]?.approvedDisruptionLevels).not.toContain('channel')
    // 后台维护事件：不给动作（读者当场做不了事）。
    expect(request.actions).toHaveLength(0)
  })

  /**
   * ② 同一来源同一天再失败 → 合并不刷屏；但**失败 → 成功 → 又失败**是新一代，能再报一条
   * （产品经理 2026-11-11：`condition` 不许做成按自然日死锁）。
   */
  it('merges repeated failures of one condition, and opens a new one after a recovery', () => {
    const first = buildCalendarRefreshFailureRequest({ providerId: 'macro-calendar-0xrouter', failureCode: 'response-unavailable', date: '2026-11-11', generation: 0 }, occurredAt)
    const again = buildCalendarRefreshFailureRequest({ providerId: 'macro-calendar-0xrouter', failureCode: 'response-unavailable', date: '2026-11-11', generation: 0 }, occurredAt)
    expect(again.dedupeVars).toEqual(first.dedupeVars)
    // 成功之后代次 +1：键不同 → 平台会新建一条，而不是并进早上那条「已经好了」的提醒。
    const afterRecovery = buildCalendarRefreshFailureRequest({ providerId: 'macro-calendar-0xrouter', failureCode: 'response-unavailable', date: '2026-11-11', generation: 1 }, occurredAt)
    expect(afterRecovery.dedupeVars).not.toEqual(first.dedupeVars)
    // 换一天也是新一代（读者的日期跟他的日历走）。
    const nextDay = buildCalendarRefreshFailureRequest({ providerId: 'macro-calendar-0xrouter', failureCode: 'response-unavailable', date: '2026-11-12', generation: 0 }, occurredAt)
    expect(nextDay.dedupeVars).not.toEqual(first.dedupeVars)
  })

  // ⑤ 正文里没有内部码：变体名就是码，句子是那句人话；没有码时用 no-code，不编原因。
  it('never lets an internal code reach the body', () => {
    const copy = marketIntelligenceNotificationCopy
    for (const language of ['zh-CN', 'en-US'] as const) {
      const table = copy[language] as unknown as Record<string, string>
      const bodyKey = (variant: string) => `notification.event.${EVENT}.body.${variant}`
      for (const variant of ['input-invalid', 'credential-not-configured', 'response-unavailable', 'archive-unavailable', 'parse-unavailable', 'storage-unavailable', 'storage-pressure', CALENDAR_REFRESH_NO_CODE_VARIANT]) {
        const sentence = table[bodyKey(variant)] ?? ''
        expect(sentence, `${language} ${variant}`).not.toBe('')
        // 正文句里不许出现任何内部码形状（`response-unavailable`、`storage-pressure`…）。
        for (const code of ['input-invalid', 'credential-not-configured', 'response-unavailable', 'archive-unavailable', 'parse-unavailable', 'storage-unavailable', 'storage-pressure']) {
          expect(sentence).not.toContain(code)
        }
        expect(sentence).toContain('{source}')
      }
    }
    // 未知码不把码写进正文，落 `no-code`。
    expect(calendarRefreshVariant('something-new')).toBe(CALENDAR_REFRESH_NO_CODE_VARIANT)
    expect(calendarRefreshVariant(undefined)).toBe(CALENDAR_REFRESH_NO_CODE_VARIANT)
  })

  // 没有通知端口时什么也不做；提交异常不影响刷新本身。
  it('does nothing without a submit port, and swallows a failing one', async () => {
    const notice = { providerId: 'macro-calendar-0xrouter', failureCode: 'response-unavailable', date: '2026-11-11', generation: 0 }
    expect(await notifyCalendarRefreshFailed(undefined, notice, occurredAt)).toBeNull()
    expect(await notifyCalendarRefreshFailed(async () => { throw new Error('boom') }, notice, occurredAt)).toBeNull()
  })

  // 去重键里的日期按读者时区：UTC 23:30 在东八区已经是第二天。
  it('reads the date in the reader time zone, not UTC', () => {
    expect(readerCalendarDay('2026-11-11T16:30:00.000Z', 'Asia/Shanghai')).toBe('2026-11-12')
    expect(readerCalendarDay('2026-11-11T16:30:00.000Z', 'UTC')).toBe('2026-11-11')
  })
})
