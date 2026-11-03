// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import type { UpdateCheckProjection } from '@platform/updates/contracts/updateCheck'
import { APP_NAVIGATE_EVENT } from '@platform/workspace/navigation/navigationRequest'

import { UpdateActionButton } from './UpdateActionButton'
import type { UpdateCheckClient } from '../settings/version/updateCheckClient'

const available: UpdateCheckProjection = {
  state: 'available',
  currentVersion: '0.2.2',
  latestVersion: '0.3.1',
  checkedAt: '2026-11-03T05:00:00.000Z'
}

let root: Root | undefined
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.innerHTML = ''
})

function clientFor(state: UpdateCheckProjection) {
  const opened: string[] = []
  const client: UpdateCheckClient = {
    getState: async () => state,
    checkNow: async () => state,
    openUpdateLink: async (destination) => {
      opened.push(destination)
      return { ok: true }
    },
    onChanged: () => () => undefined,
    getReleaseNotes: async () => ({ ok: false })
  }
  return { client, opened }
}

async function mount(client: UpdateCheckClient): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(createElement(UpdateActionButton, { language: 'zh-CN', client }))
  })
  await act(async () => {
    await Promise.resolve()
  })
  return container
}

describe('the update action button in the top bar', () => {
  it('appears only when a newer version exists, and opens About without opening the download page', async () => {
    const { client, opened } = clientFor(available)
    const container = await mount(client)
    const button = container.querySelector('button')
    expect(button).not.toBeNull()
    // 只负责发现：文字是陈述句「有新版本 X」，不是命令句「更新到 X」。
    expect(button?.textContent).toBe('有新版本 0.3.1')
    // 可读名**以可见文字开头**（label-in-name），后半句说出它真正做的事。
    expect(button?.getAttribute('aria-label')).toBe('有新版本 0.3.1，打开关于我们')

    const seen: unknown[] = []
    const onNavigate = (event: Event): void => {
      seen.push((event as CustomEvent).detail)
    }
    window.addEventListener(APP_NAVIGATE_EVENT, onNavigate)
    await act(async () => button?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    window.removeEventListener(APP_NAVIGATE_EVENT, onNavigate)

    // 站内导航：与壳层所有「去设置某页」同一条路；不调 openUpdateLink、不碰白名单。
    expect(seen).toEqual([{ navKey: 'settings', settingsPanelKey: 'about' }])
    expect(opened).toEqual([])
    // 点完不消失：结论没变，还能再点。
    expect(container.querySelector('button')).not.toBeNull()
  })

  it('falls back to "an update is available" when the version string is too long for the top bar', async () => {
    // 13 个字符（`0.10.0-beta.3`）就是判据：顶栏 42 高、单行不换行，塞不下就把按钮拉长。
    const longVersion: UpdateCheckProjection = {
      state: 'available',
      currentVersion: '0.2.2',
      latestVersion: '0.10.0-beta.3',
      checkedAt: '2026-11-03T05:00:00.000Z'
    }
    const { client } = clientFor(longVersion)
    const container = await mount(client)
    const button = container.querySelector('button')
    expect(button?.textContent).toBe('有新版本')
    // 回退时用原来那条可读名，不硬拼一个空版本号。
    expect(button?.getAttribute('aria-label')).toBe('有新版本可用，打开关于我们')
  })

  it('takes the version from the same field the version row reads', async () => {
    // 这条守的是「一个值两处各取一次」：按钮文字里的版本号只能来自投影的 `latestVersion`，
    // 和版本行「最新版本」那一格同源，否则会出现「按钮说 A、行里写最新 B」。
    const { client } = clientFor(available)
    const container = await mount(client)
    expect(container.querySelector('button')?.textContent).toBe('有新版本 0.3.1')
  })

  it('stays hidden when there is nothing newer', async () => {
    const { client } = clientFor({ state: 'up-to-date', currentVersion: '0.3.1', latestVersion: '0.3.1', checkedAt: '2026-11-03T05:00:00.000Z' })
    const container = await mount(client)
    expect(container.querySelector('button')).toBeNull()
  })
})
