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
  await act(async () => {
    root?.render(createElement(SettingsUpdateDot, { language: 'zh-CN', client }))
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
    expect(container.querySelector('[data-update-dot]')).not.toBeNull()
    // 标签是静态的一句，不带版本号——侧栏是导航，名字要稳定。
    expect(container.querySelector('[data-update-dot]')?.getAttribute('aria-label')).toBe('设置，有新版本可用')
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

  it('unsubscribes on unmount, so a removed dot cannot keep firing', async () => {
    const harness = clientFor(available)
    await mount(harness.client)
    expect(harness.listeners.size).toBe(1)
    await act(async () => root?.unmount())
    root = undefined
    expect(harness.listeners.size).toBe(0)
  })
})
