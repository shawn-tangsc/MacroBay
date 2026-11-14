import { describe, expect, it } from 'vitest'

import { createBriefingPeriodId, isBriefingPeriodId } from './periodId'

/**
 * 期次编号只有一处生成（用户 2026-11-14：手动那一版编号不带前缀，详情按「那一期」查不到，
 * 落成「这一期没有生成」）。这条用例钉住格式本身，任何一处再造编号都会红。
 */
describe('briefing period ids', () => {
  it('carries the same prefix every path uses', () => {
    const id = createBriefingPeriodId(() => '11111111-2222-3333-4444-555555555555')
    expect(id).toBe('period_11111111-2222-3333-4444-555555555555')
    expect(isBriefingPeriodId(id)).toBe(true)
  })

  it('rejects a bare uuid, which is exactly what the manual path used to produce', () => {
    expect(isBriefingPeriodId('11111111-2222-3333-4444-555555555555')).toBe(false)
  })
})
