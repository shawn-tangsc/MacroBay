// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import type { UpdateCheckProjection } from '@platform/updates/contracts/updateCheck'

import { SettingsUpdateDot } from './SettingsUpdateDot'
import type { UpdateCheckClient } from '../settings/version/updateCheckClient'

let root: Root | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.innerHTML = ''
})

function clientFor(initial: UpdateCheckProjection) {
  const listeners = new Set<(projection: UpdateCheckProjection) => void>()
  const client: UpdateCheckClient = {
    getState: async () => initial,
    checkNow: async () => initial,
    openUpdateLink: async () => ({ ok: true }),
    getReleaseNotes: async () => ({ ok: false }),
    onChanged: (callback) => {
      listeners.add(callback)
      return () => listeners.delete(callback)
    }
  }
  return {
    client,
    listeners,
    emit: (projection: UpdateCheckProjection) => {
      for (const listener of [...listeners]) listener(projection)
    }
  }
}

async function mount(client: UpdateCheckClient): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  // 真实结构：小点在侧栏那颗 <button> 里面，信息应挂在按钮的可读名上。
  await act(async () => {
    root?.render(
      createElement(
        'button',
        { type: 'button', 'aria-label': '设置' },
        createElement(SettingsUpdateDot, { language: 'zh-CN', client })
      )
    )
  })
  await act(async () => {
    await Promise.resolve()
  })
  return container
}

const available: UpdateCheckProjection = {
  state: 'available',
  currentVersion: '0.3.1',
  latestVersion: '0.4.0',
  checkedAt: '2026-11-03T00:10:00.000Z'
}

describe('the settings update dot', () => {
  it('lights up only when the main process says a newer version exists', async () => {
    const harness = clientFor(available)
    const container = await mount(harness.client)
    const dot = container.querySelector('[data-update-dot]')
    expect(dot).not.toBeNull()
    // ① 不能用 <span>：侧栏的 `.nav-item span{display:none}` 会把它一起藏掉。
    expect(dot?.tagName.toLowerCase()).toBe('i')
    // ② 读屏名挂在导航按钮上，小点自己是装饰。
    expect(dot?.getAttribute('aria-hidden')).toBe('true')
    expect(dot?.getAttribute('aria-label')).toBeNull()
    expect(container.querySelector('button')?.getAttribute('aria-label')).toBe('设置，有新版本可用')
    // ③ 计算样式不能是 none（CSS 里显式写了 inline-block；真机尺寸还得靠浏览器量）。
    expect(getComputedStyle(dot as Element).display).not.toBe('none')
  })

  it('never lights up on a failed check', async () => {
    const harness = clientFor({ state: 'unavailable', currentVersion: '0.3.1', checkedAt: '2026-11-03T00:10:00.000Z' })
    const container = await mount(harness.client)
    expect(container.querySelector('[data-update-dot]')).toBeNull()
    // 广播来一次「查不到」，照样不亮。
    await act(async () => harness.emit({ state: 'unavailable', currentVersion: '0.3.1', checkedAt: '2026-11-03T00:11:00.000Z' }))
    expect(container.querySelector('[data-update-dot]')).toBeNull()
  })

  it('follows the broadcast and goes dark only when the next conclusion says up to date', async () => {
    const harness = clientFor({ state: 'idle', currentVersion: '0.3.1' })
    const container = await mount(harness.client)
    expect(container.querySelector('[data-update-dot]')).toBeNull()

    await act(async () => harness.emit(available))
    expect(container.querySelector('[data-update-dot]')).not.toBeNull()

    await act(async () => harness.emit({ state: 'up-to-date', currentVersion: '0.4.0', latestVersion: '0.4.0', checkedAt: '2026-11-03T09:00:00.000Z' }))
    expect(container.querySelector('[data-update-dot]')).toBeNull()
  })

  it('restores the nav label when the dot goes away', async () => {
    const harness = clientFor(available)
    const container = await mount(harness.client)
    expect(container.querySelector('button')?.getAttribute('aria-label')).toBe('设置，有新版本可用')
    await act(async () =>
      harness.emit({ state: 'up-to-date', currentVersion: '0.4.0', latestVersion: '0.4.0', checkedAt: '2026-11-03T09:00:00.000Z' })
    )
    // 灭掉之后把按钮的名字还原成「设置」，别把提示留在上面。
    expect(container.querySelector('button')?.getAttribute('aria-label')).toBe('设置')
  })

  it('unsubscribes on unmount, so a removed dot cannot keep firing', async () => {
    const harness = clientFor(available)
    await mount(harness.client)
    expect(harness.listeners.size).toBe(1)
    await act(async () => root?.unmount())
    root = undefined
    expect(harness.listeners.size).toBe(0)
  })
})
