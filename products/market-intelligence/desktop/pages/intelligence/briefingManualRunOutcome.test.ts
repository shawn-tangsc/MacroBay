// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import { briefingManualRunReport } from './briefingManualRunOutcome'

const text = productText['zh-CN'].pages.intelligence.portal.dashboard.dailyBriefing

const duplicate = {
  periodId: 'p-existing',
  asOf: '2026-11-05T08:00:00.000Z',
  windowHours: 24 as const,
  language: 'en-US' as const
}

describe('replacing the edition a manual run collided with', () => {
  it('names the edition it would overwrite: date, clock, window and language', () => {
    const report = briefingManualRunReport({ result: { outcome: 'duplicate', duplicate }, text, timeZone: 'Asia/Shanghai', regenerate: vi.fn() })

    expect(report.outcome).toBe('duplicate')
    expect(report.duplicate?.label).toContain('2026-11-05')
    expect(report.duplicate?.label).toContain(text.history.windowHoursShort.replace('{hours}', '24'))
    expect(report.duplicate?.label).toContain(text.history.editionLanguages.en)
  })

  // 替换走的必须是与第一次按下**同一份**输入：期号、语言、截止与窗口。
  // 少了 `generation`，服务按当前设置跑，读者会看到「怎么变成重新生成当前版本」。
  it('reruns the collided edition with its own period, language, cutoff and window', () => {
    const regenerate = vi.fn()
    const report = briefingManualRunReport({ result: { outcome: 'duplicate', duplicate }, text, timeZone: 'Asia/Shanghai', regenerate })

    report.duplicate?.replace()

    expect(regenerate).toHaveBeenCalledWith({
      periodId: 'p-existing',
      locale: 'en-US',
      generation: { asOf: '2026-11-05T08:00:00.000Z', windowHours: 24 }
    })
  })

  it('does nothing but report an outcome when nothing collided', () => {
    const regenerate = vi.fn()
    const report = briefingManualRunReport({ result: { outcome: 'started' }, text, timeZone: 'Asia/Shanghai', regenerate })

    expect(report).toEqual({ outcome: 'started' })
    expect(regenerate).not.toHaveBeenCalled()
  })
})
