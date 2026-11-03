import { describe, expect, it } from 'vitest'

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createNotificationDeeplinkHandler } from './notificationDeeplinkHandler'

/** 记录外壳收到的那几下：关抽屉、切导航、开面板、定位行。 */
function rig() {
  const calls: string[] = []
  const handler = createNotificationDeeplinkHandler({
    productMenuEntries: [],
    navigate: (key) => calls.push(`navigate:${key}`),
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
    expect(calls).toEqual(['center:false', 'panel:task-automation', 'navigate:settings', 'focus:task-7'])
  })

  it('opens the product page and clears any stale row focus', () => {
    const { calls, handler } = rig()
    handler({ scope: 'product', productId: 'market-intelligence', pageId: 'daily-briefing' })

    expect(calls).toEqual(['center:false', 'navigate:intelligence', 'focus:none'])
  })

  it('does nothing but close the centre for a deeplink it cannot resolve', () => {
    const { calls, handler } = rig()
    handler({ scope: 'platform', pageId: 'nowhere' })

    expect(calls).toEqual(['center:false'])
  })
})

/**
 * 装配层的守卫：**必须传切页那个函数，不是只改高亮的那个**。
 *
 * 这条不是风格检查：`setActiveNavKey` 在有受控 Tab 桥时只改侧栏选中项，页面不会打开——
 * 上一版就是这么错的，而单元测试断言的是回调名，把错误机制钉住了。所以这里直接读装配源码。
 */
describe('the deeplink handler is assembled with a navigation that actually opens pages', () => {
  const shell = readFileSync(
    fileURLToPath(new URL('../AppShell.tsx', import.meta.url)),
    'utf8'
  )
  const assembly = shell.slice(
    shell.indexOf('createNotificationDeeplinkHandler({'),
    shell.indexOf('createNotificationDeeplinkHandler({') + 900
  )

  it('passes activateNavKey, which opens a tab when the bridge exists', () => {
    expect(assembly).toContain('navigate: activateNavKey')
    // 只改高亮的那个不许出现在装配里：它看起来能跳，实际只换了选中项。
    expect(assembly).not.toContain('setActiveNavKey,')
  })

  it('resolves the settings panel through the availability check', () => {
    // 产品卸载或版本差异会让面板键不存在：直接 set 就是把读者送进空屏。
    expect(assembly).toContain('resolveAvailableSettingsPanelKey(key, productSettingsEntries)')
  })
})
