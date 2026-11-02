import { describe, expect, it } from 'vitest'

import { buildTestNotificationRequest } from './testNotification'

describe('test notification request', () => {
  it('uses a different dedupe key every time, so a second click is a second record', () => {
    const first = buildTestNotificationRequest(1)
    const second = buildTestNotificationRequest(2)
    expect(first.dedupeKey).not.toBe(second.dedupeKey)
  })

  it('keeps its own source so it never eats the real breaker quota', () => {
    expect(buildTestNotificationRequest().sourceId).toBe('platform.test')
  })

  it('always includes the centre, so a blocked desktop banner still leaves a record', () => {
    expect(buildTestNotificationRequest().requestedChannels).toContain('center')
  })

  it('asks for the in-app banner too, because the copy beside the button promises one', () => {
    // 少了 toast，按钮写着「右上角会出现一条横幅」而屏幕上什么都没有——承诺与实现不一致。
    expect(buildTestNotificationRequest().requestedChannels).toContain('toast')
  })

  it('still asks for desktop, so the reader can tell whether the system let it through', () => {
    expect(buildTestNotificationRequest().requestedChannels).toContain('desktop')
  })
})
