import { describe, expect, it } from 'vitest'

import type { IntelligenceSourceProfile } from '../../../service/intelligence/schema/intelligenceSource'
import { toSaveProfileInput } from './intelligenceSourceProfileEditor'

describe('toSaveProfileInput', () => {
  it('leaves the enable switch to the toggle path, so a policy edit cannot revert it', () => {
    // 缺陷（用户实测 2026-11-10 同源）：采集策略整份回写，带着页面里那份**可能已经过期**的
    // `enabled`。行尾开关改过之后，读者再动一下采集预设，旧值就把启用状态写回去——读者看到
    // 「改了个频率，启用又自己变了」。启用只由开关那条路（setEnabled / setCalendarEnabled）写，
    // 策略保存不碰它。
    const input = toSaveProfileInput(profile())

    expect('enabled' in input).toBe(false)
    expect(input).toMatchObject({
      sourceId: 'twelve-data-market',
      collectionPreset: 'frequent',
      scopePolicy: 'all'
    })
  })
})

function profile(): IntelligenceSourceProfile {
  return {
    profileId: 'twelve-data-market-profile',
    sourceId: 'twelve-data-market',
    enabled: true,
    collectionPreset: 'frequent',
    scopePolicy: 'all',
    rawArchiveEnabled: true,
    retentionMode: 'balanced',
    autoReplayAfterParserUpgrade: true,
    updatedAt: '2026-10-14T00:00:00.000Z'
  }
}
