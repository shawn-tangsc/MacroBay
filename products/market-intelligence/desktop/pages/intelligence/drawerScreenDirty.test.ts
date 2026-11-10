import { describe, expect, it } from 'vitest'

import { hostScreenDirty } from './drawerScreenDirty'

/**
 * 「这一屏脏不脏」是**两个来源并成一个判据**：外壳上报的屏（有保存栏的那些）与来源屏的草稿
 * （凭据框这类输入，参与关闭确认、不进保存栏）。三条对偶钉住它——只有一处脏也算脏，
 * 都不脏才算干净。靠读代码确认不够：任何一处被改成「我这半不重要」，这里就红。
 */
describe('the drawer screen is dirty from either source', () => {
  it('is dirty when only the drawer screen reports a change', () => {
    expect(hostScreenDirty(true, false)).toBe(true)
  })

  it('is dirty when only the sources draft is unsaved', () => {
    expect(hostScreenDirty(false, true)).toBe(true)
  })

  it('is clean only when neither side has anything to lose', () => {
    expect(hostScreenDirty(false, false)).toBe(false)
  })
})
