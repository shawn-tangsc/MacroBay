// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDefaultAppSettings, type AppSettings, type AppSettingsPatch } from '@platform/settings/schema/appSettings'
import type { UpdateCheckProjection } from '@platform/updates/contracts/updateCheck'

import { platformText } from '../../../i18n/platformText'
import { VersionCheckRow } from './VersionCheckRow'
import type { UpdateCheckClient } from './updateCheckClient'

const text = platformText['zh-CN'].preferences.version
const linkText = platformText['zh-CN'].about.links
const actionText = platformText['zh-CN'].about.action

const idle: UpdateCheckProjection = { state: 'idle', currentVersion: '0.3.1' }
const available: UpdateCheckProjection = {
  state: 'available',
  currentVersion: '0.3.1',
  latestVersion: '0.4.0',
  checkedAt: '2026-11-03T00:10:00.000Z'
}
const unavailable: UpdateCheckProjection = {
  state: 'unavailable',
  currentVersion: '0.3.1',
  checkedAt: '2026-11-03T00:10:00.000Z'
}

let root: Root | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.innerHTML = ''
})

type ClientCalls = { getState: number; checkNow: number; openUpdateLink: number; opened: number }

function createClient(
  options: {
    state?: UpdateCheckProjection
    next?: UpdateCheckProjection
    openOk?: boolean
    checkRejects?: boolean
  } = {}
): { client: UpdateCheckClient; calls: ClientCalls } {
  const calls: ClientCalls = { getState: 0, checkNow: 0, openUpdateLink: 0, opened: 0 }
  const client: UpdateCheckClient = {
    getState: async () => {
      calls.getState += 1
      return options.state ?? available
    },
    checkNow: async () => {
      calls.checkNow += 1
      if (options.checkRejects === true) throw new Error('No handler registered')
      return options.next ?? available
    },
    onChanged: () => () => undefined,
    getReleaseNotes: async () => ({ ok: false }),
    openUpdateLink: async () => {
      calls.openUpdateLink += 1
      if (options.openOk !== false) calls.opened += 1
      return { ok: options.openOk !== false }
    }
  }
  return { client, calls }
}

async function mount(
  options: {
    client: UpdateCheckClient
    enabled?: boolean
    onUpdateSettings?: (patch: AppSettingsPatch) => Promise<void>
  }
): Promise<HTMLDivElement> {
  const container = document.createElement('div')
  document.body.append(container)
  const settings: AppSettings = {
    ...createDefaultAppSettings(),
    updates: { checkEnabled: options.enabled ?? true }
  }
  root = createRoot(container)
  await act(async () => {
    root?.render(
      createElement(VersionCheckRow, {
        settings,
        onUpdateSettings: options.onUpdateSettings ?? (async () => undefined),
        client: options.client
      })
    )
  })
  // 首帧渲染完后，getState 的 promise 才落地。
  await act(async () => {
    await Promise.resolve()
  })
  return container
}

function buttonWithText(container: HTMLElement, label: string): HTMLButtonElement | null {
  return [...container.querySelectorAll('button')].find((button) => button.textContent === label) ?? null
}

describe('the version row in the settings page', () => {
  it('shows the newer version, one pill and one download button', async () => {
    const { client } = createClient({ state: available })
    const container = await mount({ client })

    expect(container.textContent).toContain('0.3.1')
    expect(container.textContent).toContain('0.4.0')
    expect(container.textContent).toContain(text.pill.available)
    expect(buttonWithText(container, actionText.update)).not.toBeNull()
    // 永远只有一颗动作按钮：有新版时它叫「立即更新」，不再有第二颗「检查更新」。
    expect(container.querySelectorAll('button')).toHaveLength(2)
  })

  it('keeps the address out of the page: the download entry is a button, not a link', async () => {
    const { client } = createClient({ state: available })
    const container = await mount({ client })

    // 界面里没有任何指向发布页的链接，读者也看不到任何网址。
    // 注意别把 SVG 的 `xmlns` 误判成地址：查的是链接、可点元素与**读得到的文字**里有没有地址。
    expect(container.querySelectorAll('a')).toHaveLength(0)
    expect(container.querySelectorAll('[href]')).toHaveLength(0)
    expect(container.textContent).not.toContain('github.com')
    expect(container.textContent ?? '').not.toMatch(/https?:\/\//u)
  })

  it('sends only an action when the download page is opened', async () => {
    const { client, calls } = createClient({ state: available })
    const container = await mount({ client })

    await act(async () => {
      buttonWithText(container, actionText.update)?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(calls.openUpdateLink).toBe(1)
  })

  it('says it could not open the browser without touching the version conclusion', async () => {
    const { client } = createClient({ state: available, openOk: false })
    const container = await mount({ client })

    await act(async () => {
      buttonWithText(container, actionText.update)?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    const notice = container.querySelector('[role="status"]')
    // 断言**字面量**而不是常量：断言常量本身的话，文案被改坏测试照样绿（上一版就是这么漏的）。
    expect(notice?.textContent).toBe('打不开浏览器，可以稍后再试。')
    // 结论一个字不动：仍是「有新版本 0.4.0」，没有被改写成查不到或已是最新。
    expect(container.textContent).toContain(text.pill.available)
    expect(container.textContent).toContain('0.4.0')
    expect(container.textContent).not.toContain(text.pill.unavailable)
    expect(container.textContent).not.toContain(text.pill.upToDate)
  })

  it('never claims "up to date" when the check could not tell', async () => {
    const { client } = createClient({ state: unavailable })
    const container = await mount({ client })

    expect(container.textContent).toContain(text.pill.unavailable)
    expect(container.textContent).not.toContain(text.pill.upToDate)
    // 查不到时把「上次检查」一起写出来，让读者知道这行还活着。
    // 「暂时查不到」只有两层：药丸 + 一行「上次检查：{时刻} · 这不代表没有新版本」。
    // 分开两行会做出七态里最高的一档（实测 414，比带下载按钮的那档还高）。
    const checkedLine = container.querySelector('.version-checked-line')
    expect(checkedLine?.textContent).toContain('上次检查：')
    // 配的是「这一次尝试」的时刻，不是上一次成功的时刻。
    expect(checkedLine?.textContent).toContain('2026-11-03')
    expect(checkedLine?.textContent).toContain('这不代表没有新版本')
    expect(container.querySelectorAll('.version-notice')).toHaveLength(1)
    expect(buttonWithText(container, actionText.update)).toBeNull()
  })

  it('turns the button into "just checked" after a manual check, without a second waiting area', async () => {
    const { client, calls } = createClient({ state: { state: 'idle', currentVersion: '0.3.1' } })
    const container = await mount({ client })

    await act(async () => {
      buttonWithText(container, text.check)?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(calls.checkNow).toBe(1)
    expect(buttonWithText(container, text.justChecked)).not.toBeNull()
    expect(container.textContent).toContain(text.pill.available)
  })

  it('checks for real when the row is clicked: no special "development" branch left', async () => {
    const { client, calls } = createClient({ state: idle, next: available })
    const container = await mount({ client })

    // 初值「还没检查」：一颗药丸、一颗按钮，和装好的包一样。
    expect(container.textContent).toContain(text.pill.notChecked)
    expect(container.querySelectorAll('.version-line button')).toHaveLength(1)

    await act(async () => {
      buttonWithText(container, text.check)?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    // 点了就真的发一次（开发版同样如此），结果照常画出来。
    expect(calls.checkNow).toBe(1)
    expect(container.textContent).toContain(text.pill.available)
  })

  it('keeps the download entry when the switch is off but a newer version is known', async () => {
    // 死路回归：关掉自动检查后手动查到新版，却没有任何入口可去，这功能就废了一半。
    const { client, calls } = createClient({ state: available })
    const container = await mount({ client, enabled: false })

    expect(container.textContent).toContain(text.pill.available)
    const download = buttonWithText(container, actionText.update)
    expect(download).not.toBeNull()
    expect(download?.className).toContain('ant-primary-button')
    // 描述位只放一句：结论句在，「未开启自动检查」不再叠第二句（叠起来就是最高的一档）。
    expect(container.querySelectorAll('.version-notice')).toHaveLength(1)
    expect(container.querySelector('.version-notice')?.textContent).toBe(text.availableLine('0.4.0'))
    expect(container.querySelector('.version-auto-off-hint')).toBeNull()

    await act(async () => {
      download?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(calls.openUpdateLink).toBe(1)
  })

  it('uses the description slot for "automatic checks are off" only when the conclusion has no sentence', async () => {
    // 「已是最新」没有自己的解释句，这时才轮到开关那句——描述位永远只有一句。
    const { client } = createClient({ state: { state: 'up-to-date', currentVersion: '0.3.1', latestVersion: '0.3.1', checkedAt: '2026-11-03T00:10:00.000Z' } })
    const container = await mount({ client, enabled: false })

    expect(container.textContent).toContain(text.pill.upToDate)
    expect(container.querySelector('.version-auto-off-hint')?.textContent).toBe(text.autoOffLine)
    expect(container.querySelectorAll('.version-notice')).toHaveLength(0)
  })

  it('keeps one sentence in the description slot when the check cannot tell and the switch is off', async () => {
    const { client } = createClient({ state: unavailable })
    const container = await mount({ client, enabled: false })

    expect(container.textContent).toContain(text.pill.unavailable)
    expect(container.querySelectorAll('.version-notice')).toHaveLength(1)
    expect(container.querySelector('.version-auto-off-hint')).toBeNull()
  })

  it('still says "automatic checks are off" before anything has been checked', async () => {
    const { client } = createClient({ state: { state: 'idle', currentVersion: '0.3.1' } })
    const container = await mount({ client, enabled: false })

    expect(container.textContent).toContain(text.pill.autoOff)
    expect(container.textContent).toContain(text.autoOffLine)
    expect(buttonWithText(container, text.check)).not.toBeNull()
    expect(buttonWithText(container, actionText.update)).toBeNull()
  })

  it('writes the switch through the injected settings updater', async () => {
    const onUpdateSettings = vi.fn(async () => undefined)
    const { client } = createClient({ state: available })
    const container = await mount({ client, onUpdateSettings })

    const toggle = container.querySelector('[role="switch"]')
    expect(toggle).not.toBeNull()
    await act(async () => {
      ;(toggle as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(onUpdateSettings).toHaveBeenCalledWith({ updates: { checkEnabled: false } })
  })

  it('walks the keyboard in the order the acceptance line says: check, download, switch', async () => {
    const { client } = createClient({ state: available })
    const container = await mount({ client })

    const focusable = [...container.querySelectorAll('button')].map((button) => button.textContent ?? '')
    // 一颗动作按钮（有新版时叫「立即更新」）+ 开关，顺序固定。
    expect(focusable).toEqual([actionText.update, ''])
    expect(container.querySelector('[role="switch"]')).not.toBeNull()
  })

  it('points the switch and the check button at the frequency hint for screen readers', async () => {
    const { client } = createClient({ state: available })
    const container = await mount({ client })

    const hint = container.querySelector('#version-check-frequency-hint')
    expect(hint?.textContent).toBe(text.autoHint)
    expect(container.querySelector('[role="switch"]')?.getAttribute('aria-describedby')).toBe(
      'version-check-frequency-hint'
    )
    // 那一颗动作按钮挂着频率说明（有新版时它叫「立即更新」，仍是同一个位置）。
    expect(buttonWithText(container, actionText.update)?.getAttribute('aria-describedby')).toBe(
      'version-check-frequency-hint'
    )
  })

  it('stays quiet when the check cannot even be sent (development channel absent)', async () => {
    const { client } = createClient({ state: available, checkRejects: true })
    const container = await mount({ client })

    await act(async () => {
      buttonWithText(container, text.check)?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    // 不弹窗、不新增错误框：结论还是那条结论。
    expect(container.textContent).toContain(text.pill.available)
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(0)
  })
})
