import { describe, expect, it } from 'vitest'

import { rejectionTraceLevel } from './notificationSubmitRejection'

/**
 * 被拒留痕的级别只有一条规则：**谁的问题**。
 *
 * 读者侧的正常抑制（今天说满了 / 刚说过还在冷却）记 `info`；其余一律是契约被写错，记 `error`。
 * 这条用例是那唯一一处规则的反向证明：把它改错、或把某个码挪档，这里必红。
 */
describe('rejectionTraceLevel', () => {
  it('treats the contract violations named by the ruling as errors', () => {
    for (const reason of [
      'unknown-event-type',
      'missing-action',
      'copy-missing',
      'unknown-body-variant'
    ] as const) {
      expect(rejectionTraceLevel(reason), reason).toBe('error')
    }
  })

  it('treats the reader-side suppressions as info, so a real fault never drowns in false alarms', () => {
    expect(rejectionTraceLevel('daily-limit-reached')).toBe('info')
    expect(rejectionTraceLevel('minimum-gap-active')).toBe('info')
  })

  it('defaults every other contract violation to error: a new reason code is never silently quiet', () => {
    for (const reason of [
      'missing-dedupe-key',
      'invalid-dedupe-vars',
      'invalid-signal-severity',
      'stale-signal-dedupe-vars',
      'cross-product-key',
      'external-action-without-url'
    ] as const) {
      expect(rejectionTraceLevel(reason), reason).toBe('error')
    }
  })
})
