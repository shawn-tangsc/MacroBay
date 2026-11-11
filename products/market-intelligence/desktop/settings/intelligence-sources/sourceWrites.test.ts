// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SETTINGS_REVISION_EVENT, type SettingsRevisionDetail } from '../../shared/events/settingsRevision'
import { createSettingsOrigin, writeSourceEnabled } from './sourceWrites'

/**
 * 两个宿主共用的一条写路径（设置页 + 看板抽屉）。
 *
 * 判据：日历源与通用源走不同命令（一处路由）、写完发一次「来源域已变」信号、`origin` 原样带出去。
 * 抽屉接上来时，它只需要调这一个函数，不许自己再调 client。
 * （旧的 `intelligenceSourcesChanged` 广播已删；它最后一个订阅方 `useCryptoActivation` 已改订阅
 * 这条域信号——见 `useCryptoActivation.ts:55`，那里有用例钉住重读。）
 */
function installIpc(): ReturnType<typeof vi.fn> {
  const invoke = vi.fn(async (_productId: string, _method: string) => ({ ok: true }))
  ;(window as unknown as { platform: unknown }).platform = { products: { invoke } }
  return invoke
}

afterEach(() => {
  Reflect.deleteProperty(window, 'platform')
  document.body.replaceChildren()
})

describe('the one write path both surfaces share', () => {
  it('routes a generic source to setEnabled and announces both signals with the caller origin', async () => {
    const invoke = installIpc()
    const revisions: SettingsRevisionDetail[] = []
    const onRevision = (event: Event): void => { revisions.push((event as CustomEvent<SettingsRevisionDetail>).detail) }
    window.addEventListener(SETTINGS_REVISION_EVENT, onRevision)

    await writeSourceEnabled({ sourceId: 's1', kind: 'feed' }, false, 'drawer-abc')

    expect(invoke).toHaveBeenCalledWith('market-intelligence', 'intelligenceSources.setEnabled', { sourceId: 's1', enabled: false })
    expect(invoke.mock.calls.some(([, method]) => method === 'intelligenceSources.setCalendarEnabled')).toBe(false)
    expect(revisions).toEqual([{ domain: 'sources', origin: 'drawer-abc' }])

    window.removeEventListener(SETTINGS_REVISION_EVENT, onRevision)
  })

  it('routes a calendar feed to the calendar command, not the generic one', async () => {
    const invoke = installIpc()
    await writeSourceEnabled({ sourceId: 'macro-calendar-fed', kind: 'official-calendar' }, true, 'page-1')

    expect(invoke).toHaveBeenCalledWith('market-intelligence', 'intelligenceSources.setCalendarEnabled', { sourceId: 'macro-calendar-fed', enabled: true })
    expect(invoke.mock.calls.some(([, method]) => method === 'intelligenceSources.setEnabled')).toBe(false)
  })

  it('gives each surface its own origin, so a save never triggers its own re-read', () => {
    expect(createSettingsOrigin('sources')).not.toBe(createSettingsOrigin('sources'))
  })
})
