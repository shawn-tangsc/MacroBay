// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { UpdateCheckProjection } from '@platform/updates/contracts/updateCheck'

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
  vi.useRealTimers()
})

function clientFor(state: UpdateCheckProjection, ok: boolean) {
  const opened: string[] = []
  const client: UpdateCheckClient = {
    getState: async () => state,
    checkNow: async () => state,
    openUpdateLink: async (destination) => {
      opened.push(destination)
      return { ok }
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
  it('appears only when a newer version exists, and opens the download page without navigating', async () => {
    const { client, opened } = clientFor(available, true)
    const container = await mount(client)
    const button = container.querySelector('button')
    expect(button).not.toBeNull()
    // 用户 11-03：「一点都不醒目」——现在是实心按钮 + 文字，文字带目标版本号。
    expect(button?.textContent).toBe('更新到 0.3.1')
    // 可读名**以可见文字开头**（label-in-name），后半句补动作。
    expect(button?.getAttribute('aria-label')).toBe('更新到 0.3.1，打开下载页')

    await act(async () => button?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(opened).toEqual(['download'])
    // 点完不消失：结论没变，还能再点（等于重试）。
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
    const { client } = clientFor(longVersion, true)
    const container = await mount(client)
    const button = container.querySelector('button')
    expect(button?.textContent).toBe('有新版本')
    // 回退时用原来那条可读名，不硬拼一个空版本号。
    expect(button?.getAttribute('aria-label')).toBe('有新版本可用，打开下载页')
  })

  it('takes the version from the same field the version row reads', async () => {
    // 这条守的是「一个值两处各取一次」：按钮文字里的版本号只能来自投影的 `latestVersion`，
    // 和版本行「最新版本」那一格同源，否则会出现「按钮说更新到 A、行里写最新 B」。
    const { client } = clientFor(available, true)
    const container = await mount(client)
    expect(container.querySelector('button')?.textContent).toBe(`更新到 ${available.state === 'available' ? available.latestVersion : ''}`)
  })

  it('stays hidden when there is nothing newer', async () => {
    const { client } = clientFor({ state: 'up-to-date', currentVersion: '0.3.1', latestVersion: '0.3.1', checkedAt: '2026-11-03T05:00:00.000Z' }, true)
    const container = await mount(client)
    expect(container.querySelector('button')).toBeNull()
  })

  it('shows a four-second warning, announces once, keeps its name, and lets the reader retry', async () => {
    vi.useFakeTimers()
    const { client, opened } = clientFor(available, false)
    const container = await mount(client)
    const button = container.querySelector('button')!

    await act(async () => button.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    // 失败：播报一句（role=status），**文字与可读名都不变**——它做的事没变，只换图标。
    expect(container.querySelector('[role="status"]')?.textContent).toBe('没能打开浏览器，可再点一次重试')
    expect(button.getAttribute('aria-label')).toBe('更新到 0.3.1，打开下载页')
    expect(button.textContent).toBe('更新到 0.3.1')

    // 4 秒后回到正常态，播报消失。
    await act(async () => {
      vi.advanceTimersByTime(4000)
    })
    expect(container.querySelector('[role="status"]')).toBeNull()

    // 再点一次 = 重试，会再次尝试打开。
    await act(async () => button.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(opened).toHaveLength(2)
  })
})
