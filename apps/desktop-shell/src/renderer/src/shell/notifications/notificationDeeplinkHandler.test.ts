import { describe, expect, it } from 'vitest'

import { createNotificationDeeplinkHandler } from './notificationDeeplinkHandler'

/** 记录外壳收到的那几下：关抽屉、切导航、开面板、定位行。 */
function rig() {
  const calls: string[] = []
  const handler = createNotificationDeeplinkHandler({
    productMenuEntries: [],
    setActiveNavKey: (key) => calls.push(`nav:${key}`),
    setSettingsPanelKey: (key) => calls.push(`panel:${key}`),
    setNotificationCenterOpen: (open) => calls.push(`center:${open}`),
    setFocusEntityId: (id) => calls.push(`focus:${id ?? 'none'}`)
  })
  return { calls, handler }
}

describe('notification deeplink handler', () => {
  it('closes the centre first, then lands on the panel and points at the row', () => {
    const { calls, handler } = rig()
    handler({ scope: 'platform', entityType: 'job-definition', entityId: 'task-7' })

    // 顺序是有意的：抽屉先关，读者不会看着旧列表又自己跳走。
    expect(calls).toEqual(['center:false', 'panel:task-automation', 'nav:settings', 'focus:task-7'])
  })

  it('opens the product page and clears any stale row focus', () => {
    const { calls, handler } = rig()
    handler({ scope: 'product', productId: 'market-intelligence', pageId: 'daily-briefing' })

    expect(calls).toEqual(['center:false', 'nav:intelligence', 'focus:none'])
  })

  it('does nothing but close the centre for a deeplink it cannot resolve', () => {
    const { calls, handler } = rig()
    handler({ scope: 'platform', pageId: 'nowhere' })

    expect(calls).toEqual(['center:false'])
  })
})
