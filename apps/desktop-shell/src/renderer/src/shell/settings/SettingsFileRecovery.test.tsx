// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { platformText } from '../../i18n/platformText'

import { SettingsReadFailureBanner, SettingsResetDangerZone } from './SettingsFileRecovery'

const text = platformText['zh-CN'].settings
const copyPath = '/Users/reader/Library/Application Support/MacroBay/settings.json.corrupt-1794242244560'

let root: Root | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

function mount(element: React.ReactElement): HTMLElement {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root?.render(element))
  return container
}

describe('启动期设置文件读不到的恢复面', () => {
  it('says the app started on defaults and gives the copy path on the second line, not in a popover', () => {
    const container = mount(
      createElement(SettingsReadFailureBanner, { text, copyPath, retrying: false, onRetry: () => undefined })
    )

    expect(container.textContent).toContain(text.settingsFileUnreadable)
    // 路径是正文里的 `<code>`，直接可选中复制；不是折叠说明。
    const pathLine = container.querySelector('[data-settings-copy-path]')
    expect(pathLine?.tagName).toBe('CODE')
    expect(pathLine?.textContent).toContain(copyPath)
    expect(container.querySelector('button')?.textContent).toBe(text.settingsFileRetry)
  })

  it('never claims a copy was kept when no path came back', () => {
    const container = mount(
      createElement(SettingsReadFailureBanner, { text, copyPath: null, retrying: false, onRetry: () => undefined })
    )

    expect(container.textContent).toContain(text.settingsFileCopyMissing)
    expect(container.textContent).not.toContain('已保留副本')
    expect(container.querySelector('[data-settings-copy-path]')).toBeNull()
  })

  it('retries from the banner, and the irreversible reset is not next to it', () => {
    const onRetry = vi.fn()
    const container = mount(
      createElement(SettingsReadFailureBanner, { text, copyPath, retrying: false, onRetry })
    )

    // 「重置设置」不进这一行：横幅里没有它，读者不会把不可逆动作当成"再试一次"。
    expect(container.textContent).not.toContain(text.settingsReset)
    act(() => (container.querySelector('button') as HTMLButtonElement).click())
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('keeps reset behind a confirmation that names the copy path', async () => {
    const onReset = vi.fn(async () => undefined)
    const container = mount(createElement(SettingsResetDangerZone, { text, copyPath, onReset }))

    const resetButton = container.querySelector('button') as HTMLButtonElement
    expect(resetButton.textContent).toBe(text.settingsReset)
    // 静止红：danger 档不靠 hover（antd 的 `ant-btn-dangerous`）。
    expect(resetButton.className).toContain('ant-btn-dangerous')
    expect(onReset).not.toHaveBeenCalled()

    await act(async () => {
      resetButton.click()
      await Promise.resolve()
    })
    expect(document.body.textContent).toContain(text.settingsResetConfirmBody)
    expect(document.body.textContent).toContain(copyPath)

    const confirm = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === text.settingsResetConfirm
    ) as HTMLButtonElement
    await act(async () => {
      confirm.click()
      await Promise.resolve()
    })
    expect(onReset).toHaveBeenCalledOnce()
  })
})
