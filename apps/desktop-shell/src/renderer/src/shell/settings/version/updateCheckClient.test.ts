// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { createDefaultAppSettings } from '@platform/settings/schema/appSettings'

import { platformText } from '../../../i18n/platformText'
import { VersionCheckRow } from './VersionCheckRow'
import { platformUpdateCheckClient } from './updateCheckClient'

/**
 * 桥缺失时的行为。
 *
 * 这条是上一轮被守卫抓出来才改对的：以前 `window.platform.updates.getState()` 会在 effect 里
 * **同步抛**，把整个设置页炸掉（应用没重启、或者测试里只桩了一半的 platform 都会这样）。
 * 现在改成 rejected promise，hook 的 catch 把界面停在「还没检查」。
 *
 * 没有这条测试，改回同步抛也一路绿——所以这里测两件事：**不是同步抛**，以及**界面不白屏**。
 */

const text = platformText['zh-CN'].preferences.version
const originalPlatform = (window as { platform?: unknown }).platform
let root: Root | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.innerHTML = ''
  ;(window as { platform?: unknown }).platform = originalPlatform
})

describe('the platform update client without its bridge', () => {
  it('rejects instead of throwing synchronously, so a missing bridge cannot take the page down', async () => {
    delete (window as { platform?: unknown }).platform

    // 同步抛会让 React 在 effect 里炸掉整棵树；这里必须是「先返回 promise，再 reject」。
    let pending: Promise<unknown> | undefined
    expect(() => {
      pending = platformUpdateCheckClient.getState()
    }).not.toThrow()
    await expect(pending).rejects.toThrow(/bridge/u)
    await expect(platformUpdateCheckClient.checkNow()).rejects.toThrow(/bridge/u)
    await expect(platformUpdateCheckClient.openUpdateLink('docs')).rejects.toThrow(/bridge/u)
  })

  it('still renders the row as "not checked yet" instead of crashing the settings page', async () => {
    delete (window as { platform?: unknown }).platform

    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(
        createElement(VersionCheckRow, {
          settings: createDefaultAppSettings(),
          onUpdateSettings: async () => undefined,
          client: platformUpdateCheckClient
        })
      )
    })
    // 让 getState 的 rejection 走完那条 catch。
    await act(async () => {
      await Promise.resolve()
    })

    expect(container.textContent).toContain(text.pill.notChecked)
    expect(container.textContent).toContain(text.current)
  })

  it('passes calls through when the bridge is there', async () => {
    ;(window as { platform?: unknown }).platform = {
      updates: {
        getState: async () => ({ state: 'idle', currentVersion: '0.3.1' }),
        checkNow: async () => ({ state: 'available', currentVersion: '0.3.1', latestVersion: '0.4.0', checkedAt: '2026-11-03T00:10:00.000Z' }),
        openUpdateLink: async () => ({ ok: true })
      }
    }

    await expect(platformUpdateCheckClient.getState()).resolves.toEqual({ state: 'idle', currentVersion: '0.3.1' })
    await expect(platformUpdateCheckClient.openUpdateLink('docs')).resolves.toEqual({ ok: true })
  })
})
