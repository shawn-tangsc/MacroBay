import { describe, expect, it } from 'vitest'

import { getTaskAutomationPolicy, validateTaskAutomationLimits } from './taskAutomationPolicy'

describe('taskAutomationPolicy', () => {
  it('maps only platform-owned presets to fixed limits', () => {
    expect(getTaskAutomationPolicy('balanced')).toMatchObject({
      maxActiveTasksPerAgent: 30,
      minimumRecurringIntervalMs: 5 * 60 * 1000,
      maximumTimeoutMinutes: 120
    })
    expect(getTaskAutomationPolicy('conservative').maxActiveTasksPerAgent).toBeLessThan(30)
  })

  it('rejects active-task and timeout limits without accepting raw caller limits', () => {
    const policy = getTaskAutomationPolicy('conservative')
    expect(validateTaskAutomationLimits(policy, { activeTaskCount: policy.maxActiveTasksPerAgent, timeoutMinutes: 1 })).toEqual({
      ok: false,
      code: 'task-policy-limit'
    })
    expect(validateTaskAutomationLimits(policy, { activeTaskCount: 0, timeoutMinutes: policy.maximumTimeoutMinutes + 1 })).toEqual({
      ok: false,
      code: 'task-policy-limit'
    })
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects a non-positive, fractional, or non-finite timeout of %p',
    (timeoutMinutes) => {
      expect(validateTaskAutomationLimits(getTaskAutomationPolicy('balanced'), { activeTaskCount: 0, timeoutMinutes })).toEqual({
        ok: false,
        code: 'task-policy-limit'
      })
    }
  )
})
