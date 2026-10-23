import { expect, it } from 'vitest'

import { providerAwaitingData, providerLifecycleState } from './marketCalendarEventLifecycle'

/**
 * 「已到计划时刻、值还没到」这一格（读者 2026-10-16）。
 *
 * 它存在的理由：provider 的发布节奏与我们的采集节奏不是一件事，时间到了值没到，既不是「未到时间」也
 * 不是「已公布」。判据与上面「有值才算已发布」是同一条口径，所以两者必须互相印证。
 */
const nowIso = '2026-10-16T01:30:00.000Z'

it('is waiting only after the scheduled time has passed without a value', () => {
  expect(providerAwaitingData({ scheduledAt: '2026-10-15T12:30:00.000Z', actual: null }, nowIso)).toBe(true)
  expect(providerAwaitingData({ scheduledAt: '2026-10-16T12:30:00.000Z', actual: null }, nowIso)).toBe(false)
  expect(providerAwaitingData({ scheduledAt: null, actual: null }, nowIso)).toBe(false)
})

it('is not waiting once the value is there, which is the same rule that calls it released', () => {
  const released = { scheduledAt: '2026-10-15T12:30:00.000Z', actual: { displayValue: '6.3%' } }
  expect(providerAwaitingData(released, nowIso)).toBe(false)
  expect(providerLifecycleState({ providerActual: released.actual })).toBe('released')
})
