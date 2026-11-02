// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { createDefaultAppSettings } from '@platform/settings/schema/appSettings'
import type { UpdateCheckProjection } from '@platform/updates/contracts/updateCheck'

import { platformText } from '../../../i18n/platformText'
import { AboutSettingsPage } from './AboutSettingsPage'
import type { UpdateCheckClient } from '../version/updateCheckClient'

const text = platformText['zh-CN'].about
const versionText = platformText['zh-CN'].preferences.version

let root: Root | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.innerHTML = ''
})

function clientFor(state: UpdateCheckProjection): UpdateCheckClient {
  return {
    getState: async () => state,
    checkNow: async () => state,
    openUpdateLink: async () => ({ ok: true })
  }
}

async function mount(state: UpdateCheckProjection): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(
      createElement(AboutSettingsPage, {
        settings: createDefaultAppSettings(),
        onUpdateSettings: async () => undefined,
        productName: 'MacroBay',
        client: clientFor(state)
      })
    )
  })
  await act(async () => {
    await Promise.resolve()
  })
  return container
}

describe('the about page', () => {
  it('says which version is installed and whether there is a newer one', async () => {
    const container = await mount({
      state: 'available',
      currentVersion: '0.3.1',
      latestVersion: '0.4.0',
      checkedAt: '2026-11-03T00:10:00.000Z'
    })

    expect(container.textContent).toContain('MacroBay')
    expect(container.textContent).toContain(text.tagline)
    expect(container.textContent).toContain(text.updates)
    // 更新块是同一个组件，文案与药丸沿用已签过的那一版。
    expect(container.textContent).toContain(versionText.pill.available)
    expect(container.textContent).toContain('0.4.0')
  })

  it('keeps the whole row when the check cannot tell', async () => {
    const container = await mount({
      state: 'unavailable',
      currentVersion: '0.3.1',
      checkedAt: '2026-11-03T00:10:00.000Z'
    })

    expect(container.textContent).toContain(versionText.pill.unavailable)
    expect(container.textContent).toContain(versionText.unavailableLine)
  })

  it('holds no address anywhere in the page', async () => {
    const container = await mount({ state: 'idle', currentVersion: '0.3.1' })

    // 关于页同样不持有网址：没有链接、文字里也没有 http 地址。
    expect(container.querySelectorAll('a')).toHaveLength(0)
    expect(container.querySelectorAll('[href]')).toHaveLength(0)
    expect(container.textContent ?? '').not.toMatch(/https?:\/\//u)
  })
})
