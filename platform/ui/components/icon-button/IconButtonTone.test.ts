import { describe, expect, it } from 'vitest'

import type { IconButtonTone } from './IconButton'

/**
 * `tone` 的闭集。放在 `.ts` 而不是 `.test.tsx`：主 `typecheck` 不收平台下的 `.tsx`，
 * 而这条判据就是类型本身——写错的值必须在编译期红，不能等提交钩子。
 */
describe('IconButton tone', () => {
  it('accepts exactly one tone, and nothing outside the closed set', () => {
    // @ts-expect-error tone 只收 'danger'
    const invalid: IconButtonTone = 'warning'
    expect(invalid).toBe('warning')
  })

  it('keeps danger available', () => {
    const valid: IconButtonTone = 'danger'
    expect(valid).toBe('danger')
  })
})
