import { describe, expect, it } from 'vitest'

import { createNotificationSelfTestCandidates } from './notificationSelfTestCandidates'

/** 三条取数由产品线各自实现；这一层只做分发，**没有实现的那条必须诚实报 read-failed**。 */
const candidate = {
  ok: true as const,
  request: {
    eventTypeId: 'market-intelligence.calendar.event-upcoming',
    dedupeVars: { builder: 'template' as const, vars: {} },
    actions: [],
    occurredAt: '2026-11-08T00:00:00.000Z'
  }
}

describe('notification self-test candidates', () => {
  it('passes a wired reader through unchanged', async () => {
    const port = createNotificationSelfTestCandidates({ sentiment: async () => candidate })
    await expect(port('sentiment')).resolves.toEqual(candidate)
  })

  it('says read-failed for a kind that is not wired yet, instead of inventing data', async () => {
    const port = createNotificationSelfTestCandidates({ sentiment: async () => candidate })
    await expect(port('calendar-landed')).resolves.toEqual({ ok: false, reasonCode: 'read-failed' })
  })

  it('turns a throwing reader into read-failed: the button must not crash the click', async () => {
    const port = createNotificationSelfTestCandidates({ 'calendar-upcoming': async () => { throw new Error('db locked') } })
    await expect(port('calendar-upcoming')).resolves.toEqual({ ok: false, reasonCode: 'read-failed' })
  })
})
