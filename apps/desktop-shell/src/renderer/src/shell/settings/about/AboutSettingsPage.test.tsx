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

function clientFor(
  state: UpdateCheckProjection,
  options: { openOk?: boolean; opened?: string[] } = {}
): UpdateCheckClient {
  return {
    getState: async () => state,
    checkNow: async () => state,
    openUpdateLink: async (destination) => {
      options.opened?.push(destination)
      return { ok: options.openOk !== false }
    },
    onChanged: () => () => undefined
  }
}

async function mount(state: UpdateCheckProjection, client?: UpdateCheckClient): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(
      createElement(AboutSettingsPage, {
        settings: createDefaultAppSettings(),
        onUpdateSettings: async () => undefined,
        productName: 'MacroBay',
        client: client ?? clientFor(state)
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

  it('lists the four link destinations with their action words', async () => {
    const container = await mount({ state: 'idle', currentVersion: '0.3.1' })
    const rows = [...container.querySelectorAll('.about-link-row')]
    expect(rows).toHaveLength(4)
    expect(rows.map((row) => row.textContent)).toEqual([
      `${text.links.changelog}${text.links.actionView}`,
      `${text.links.docs}${text.links.actionView}`,
      `${text.links.site}${text.links.actionView}`,
      `${text.links.feedback}${text.links.actionFeedback}`
    ])
    // 「打开下载页」只由更新块渲染，链接块不重复。
    expect(container.textContent).not.toContain(text.links.download)
  })

  it('sends the id of the row that was clicked, never an address', async () => {
    const opened: string[] = []
    const container = await mount({ state: 'idle', currentVersion: '0.3.1' }, clientFor({ state: 'idle', currentVersion: '0.3.1' }, { opened }))
    const buttons = [...container.querySelectorAll('.about-link-row button')]
    await act(async () => {
      buttons[0].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(opened).toEqual(['changelog'])
  })

  it('says the browser did not open, using the sentence all five buttons share', async () => {
    const container = await mount(
      { state: 'idle', currentVersion: '0.3.1' },
      clientFor({ state: 'idle', currentVersion: '0.3.1' }, { openOk: false })
    )
    const buttons = [...container.querySelectorAll('.about-link-row button')]
    await act(async () => {
      buttons[2].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(container.querySelector('[role="status"]')?.textContent).toBe(text.links.openFailed)
  })

  it('holds no address anywhere in the page', async () => {
    const container = await mount({ state: 'idle', currentVersion: '0.3.1' })

    // 关于页同样不持有网址：没有链接、文字里也没有 http 地址。
    expect(container.querySelectorAll('a')).toHaveLength(0)
    expect(container.querySelectorAll('[href]')).toHaveLength(0)
    expect(container.textContent ?? '').not.toMatch(/https?:\/\//u)
  })
})
