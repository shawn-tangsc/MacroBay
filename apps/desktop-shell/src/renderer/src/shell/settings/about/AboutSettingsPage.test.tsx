// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { ConfigProvider } from 'antd'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { createDefaultAppSettings } from '@platform/settings/schema/appSettings'
import type { UpdateCheckProjection } from '@platform/updates/contracts/updateCheck'
import { WINDOW_ANTD_BUTTON_CONFIG } from '@platform/ui/theme/windowAntdTheme'

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
  options: { openOk?: boolean; opened?: string[]; notes?: unknown[] | null; truncated?: boolean } = {}
): UpdateCheckClient {
  return {
    getState: async () => state,
    checkNow: async () => state,
    getReleaseNotes: async () =>
      options.notes
        ? { ok: true, version: '0.4.0', nodes: options.notes as never, truncated: options.truncated === true }
        : { ok: false },
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
    // 真机里由主窗/分离窗的 ConfigProvider 统一关掉「两个汉字之间加空格」；测试沿用同一份配置，
    // 不给按钮写逐处覆盖（buttonSpaceGuard 只允许它在 windowAntdTheme 里出现）。
    root?.render(
      createElement(
        ConfigProvider,
        { button: WINDOW_ANTD_BUTTON_CONFIG },
        createElement(AboutSettingsPage, {
          settings: createDefaultAppSettings(),
          onUpdateSettings: async () => undefined,
          productName: 'MacroBay',
          client: client ?? clientFor(state)
        })
      )
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
    expect(container.querySelectorAll('.about-section .preference-heading')).toHaveLength(1)
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
    expect(container.textContent).not.toContain(platformText['zh-CN'].about.action.update)
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

  it('styles every link action as an outlined secondary button, not a blue text link', async () => {
    const container = await mount({ state: 'idle', currentVersion: '0.3.1' })
    const buttons = [...container.querySelectorAll<HTMLButtonElement>('.about-link-row button')]
    expect(buttons).toHaveLength(4)
    for (const button of buttons) {
      // 14b：这一页只允许一种交互色（主按钮的荧光绿）；antd 默认蓝链接会把页面变成第二个交互色。
      expect(button.classList.contains('ant-secondary-button')).toBe(true)
      expect(button.className).not.toContain('ant-btn-link')
    }
  })

  it('styles the notes disclosure as the same secondary button', async () => {
    const notes = Array.from({ length: 8 }, (_, index) => ({
      kind: 'paragraph',
      runs: [{ text: `第 ${index + 1} 条`, bold: false }]
    }))
    const state = { state: 'available', currentVersion: '0.3.1', latestVersion: '0.4.0', checkedAt: '2026-11-03T00:10:00.000Z' } as const
    const container = await mount(state, clientFor(state, { notes }))
    const toggle = container.querySelector<HTMLButtonElement>('.about-notes button')
    expect(toggle?.textContent).toBe(text.notes.expand)
    expect(toggle?.classList.contains('ant-secondary-button')).toBe(true)
    expect(toggle?.className).not.toContain('ant-btn-link')

    // 两字标签（收起）走同一份全局配置：不出现「收 起」的插入空格。
    await act(async () => {
      toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(container.querySelector('.about-notes button')?.textContent).toBe(text.notes.collapse)
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

  it('shows the notes only when a newer version exists', async () => {
    const notes = [
      { kind: 'section', title: '本次更新' },
      { kind: 'paragraph', runs: [{ text: '修好了一个问题', bold: false }] }
    ]
    const shown = await mount(
      { state: 'available', currentVersion: '0.3.1', latestVersion: '0.4.0', checkedAt: '2026-11-03T00:10:00.000Z' },
      clientFor({ state: 'available', currentVersion: '0.3.1', latestVersion: '0.4.0', checkedAt: '2026-11-03T00:10:00.000Z' }, { notes })
    )
    expect(shown.querySelector('[data-structured-text]')).not.toBeNull()
    expect(shown.textContent).toContain('修好了一个问题')

    const hidden = await mount(
      { state: 'up-to-date', currentVersion: '0.3.1', latestVersion: '0.3.1', checkedAt: '2026-11-03T00:10:00.000Z' },
      clientFor({ state: 'up-to-date', currentVersion: '0.3.1', latestVersion: '0.3.1', checkedAt: '2026-11-03T00:10:00.000Z' }, { notes })
    )
    // 已是最新时不铺开：那段正文属于最新那版，未必是读者正在跑的这版。
    expect(hidden.querySelector('[data-structured-text]')).toBeNull()
  })

  it('says the note was truncated only when it really was', async () => {
    const notes = [{ kind: 'paragraph', runs: [{ text: '开头', bold: false }] }]
    const truncated = await mount(
      { state: 'available', currentVersion: '0.3.1', latestVersion: '0.4.0', checkedAt: '2026-11-03T00:10:00.000Z' },
      clientFor({ state: 'available', currentVersion: '0.3.1', latestVersion: '0.4.0', checkedAt: '2026-11-03T00:10:00.000Z' }, { notes, truncated: true })
    )
    expect(truncated.querySelector('.about-notes-truncated')?.textContent).toBe(
      platformText['zh-CN'].about.notes.truncated
    )

    const whole = await mount(
      { state: 'available', currentVersion: '0.3.1', latestVersion: '0.4.0', checkedAt: '2026-11-03T00:10:00.000Z' },
      clientFor({ state: 'available', currentVersion: '0.3.1', latestVersion: '0.4.0', checkedAt: '2026-11-03T00:10:00.000Z' }, { notes })
    )
    // 正好在上限内：不出这一行。
    expect(whole.querySelector('.about-notes-truncated')).toBeNull()
  })

  it('holds no address anywhere in the page', async () => {
    const container = await mount({ state: 'idle', currentVersion: '0.3.1' })

    // 关于页同样不持有网址：没有链接、文字里也没有 http 地址。
    expect(container.querySelectorAll('a')).toHaveLength(0)
    expect(container.querySelectorAll('[href]')).toHaveLength(0)
    expect(container.textContent ?? '').not.toMatch(/https?:\/\//u)
  })
})
