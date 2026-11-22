import { describe, expect, it } from 'vitest'

import { briefingPosterTarget } from './BriefingPosterWindow'

/**
 * 窗口参数只有一种合法形状：**哪一版**（日期＋期号＋语言）三件套齐全。
 *
 * 这一条守的不是解析，是「不猜」：少一个就渲染一张错的图交给读者，比这次没图糟得多。
 * 所以缺参、日期形状不对、语言认不出，都必须回 `null`（调用点据此落 `invalid-params`）。
 */
describe('briefing poster window target', () => {
  const valid = new URLSearchParams({ date: '2026-11-20', periodId: 'p1', locale: 'zh-CN' })

  it('reads the edition identity from the launch parameters', () => {
    expect(briefingPosterTarget(valid)).toEqual({ date: '2026-11-20', periodId: 'p1', locale: 'zh-CN' })
    expect(briefingPosterTarget(new URLSearchParams({ date: '2026-11-20', periodId: 'p1', locale: 'en-US' })))
      .toEqual({ date: '2026-11-20', periodId: 'p1', locale: 'en-US' })
  })

  it('refuses to guess a missing or malformed parameter', () => {
    expect(briefingPosterTarget(new URLSearchParams({ periodId: 'p1', locale: 'zh-CN' }))).toBeNull()
    expect(briefingPosterTarget(new URLSearchParams({ date: '2026-11-20', locale: 'zh-CN' }))).toBeNull()
    expect(briefingPosterTarget(new URLSearchParams({ date: '2026-11-20', periodId: 'p1' }))).toBeNull()
    expect(briefingPosterTarget(new URLSearchParams({ date: 'today', periodId: 'p1', locale: 'zh-CN' }))).toBeNull()
    expect(briefingPosterTarget(new URLSearchParams({ date: '2026-11-20', periodId: 'p1', locale: 'fr-FR' }))).toBeNull()
  })
})