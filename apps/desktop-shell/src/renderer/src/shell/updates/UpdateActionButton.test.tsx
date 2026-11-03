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
    // 可读名说明它做什么，不带版本号。
    expect(button?.getAttribute('aria-label')).toBe('有新版本可用，打开下载页')

    await act(async () => button?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(opened).toEqual(['download'])
    // 点完不消失：结论没变，还能再点（等于重试）。
    expect(container.querySelector('button')).not.toBeNull()
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
    // 失败：播报一句（role=status），可读名**不变**——它做的事没变。
    expect(container.querySelector('[role="status"]')?.textContent).toBe('没能打开浏览器，可再点一次重试')
    expect(button.getAttribute('aria-label')).toBe('有新版本可用，打开下载页')

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
