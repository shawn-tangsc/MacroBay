import { describe, expect, it } from 'vitest'

import { shouldShowAutoDisabledHint } from './autoDisabledHint'

/**
 * 「曾被规则自动停用、之后没再启用」的提示判据（原型 2026-11-13）。
 *
 * 最容易写错的一条：**审计有过、但后来重新启用过** → 不提示。
 * 只按「有没有那条审计」判，会把读者已经处理好的通道再催一遍。
 */
describe('shouldShowAutoDisabledHint', () => {
  it('shows when the rule disabled it and it was never re-enabled', () => {
    expect(shouldShowAutoDisabledHint({ autoDisabledAt: '2026-11-11T10:00:00.000Z', lastEnabledAt: null })).toBe(true)
  })

  it('stays hidden when it was re-enabled after the automatic disable', () => {
    expect(shouldShowAutoDisabledHint({
      autoDisabledAt: '2026-11-11T10:00:00.000Z',
      lastEnabledAt: '2026-11-12T09:00:00.000Z'
    })).toBe(false)
  })

  it('stays hidden when the only enable predates the automatic disable', () => {
    // 启用过、后来又被人为停用？那是另一回事；这里只有「规则停用之后有没有再启用」这一条判据。
    expect(shouldShowAutoDisabledHint({
      autoDisabledAt: '2026-11-11T10:00:00.000Z',
      lastEnabledAt: '2026-11-10T09:00:00.000Z'
    })).toBe(true)
  })

  it('hides when there is no audit evidence at all (nothing known, nothing claimed)', () => {
    expect(shouldShowAutoDisabledHint(undefined)).toBe(false)
    expect(shouldShowAutoDisabledHint({ autoDisabledAt: null, lastEnabledAt: null })).toBe(false)
    expect(shouldShowAutoDisabledHint({ autoDisabledAt: null, lastEnabledAt: '2026-11-12T09:00:00.000Z' })).toBe(false)
  })

  it('treats a same-instant re-enable as already handled, so the reader is not nagged', () => {
    expect(shouldShowAutoDisabledHint({
      autoDisabledAt: '2026-11-11T10:00:00.000Z',
      lastEnabledAt: '2026-11-11T10:00:00.000Z'
    })).toBe(false)
  })
})
