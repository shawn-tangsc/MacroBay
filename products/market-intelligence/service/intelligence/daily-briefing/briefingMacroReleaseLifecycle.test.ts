import { describe, expect, it } from 'vitest'

import { briefingMacroReleaseLifecycle } from './briefingMacroReleaseLifecycle'

describe('briefing macro rows read the source status, never the presence of a value', () => {
  it('treats only "published" as released', () => {
    expect(briefingMacroReleaseLifecycle('published')).toEqual({ lifecycleState: 'released', valueVisible: true })
  })

  it('keeps a cancelled release cancelled, never scheduled-with-a-value', () => {
    expect(briefingMacroReleaseLifecycle('cancelled')).toEqual({ lifecycleState: 'cancelled', valueVisible: false })
  })

  it('does not publish an expired row just because its date has passed', () => {
    // 今天那个 bug 的形状：源说 scheduled（或 unknown / 缺省），日期早过了——不许变成已发布。
    for (const status of ['scheduled', 'unknown', undefined] as const) {
      expect(briefingMacroReleaseLifecycle(status), String(status))
        .toEqual({ lifecycleState: 'scheduled', valueVisible: false })
    }
  })

  it('falls back to "not published" for a status this build does not know yet', () => {
    // 五态会新增 backfilling / missing；认不出时只许少说「已发布」，不许把没值的行说成有值。
    for (const status of ['backfilling', 'missing', 'some-future-word'] as never[]) {
      expect(briefingMacroReleaseLifecycle(status), String(status))
        .toEqual({ lifecycleState: 'scheduled', valueVisible: false })
    }
  })
})
