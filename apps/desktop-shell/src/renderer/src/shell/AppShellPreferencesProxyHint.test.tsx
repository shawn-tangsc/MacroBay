// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDefaultAppSettings } from '@platform/settings/schema/appSettings'

import { platformText } from '../i18n/platformText'
import { AppShell } from './AppShell'
import { installPlatform } from './model-service/modelServicePageHarness'

/**
 * PLAT-61：基础设置 → 代理段的一句灰字说明（应用请求走这里的代理；浏览器能打开≠应用能连）。
 */
const labels = platformText['en-US'].preferences

let root: Root | undefined
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  window.localStorage.clear()
  Reflect.deleteProperty(window, 'platform')
})

async function clickButton(container: ParentNode, text: string): Promise<void> {
  const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent?.trim() === text
  )
  if (!button) throw new Error(`Expected ${text} button.`)
  await act(async () => button.click())
}

async function renderBasicSettings(options: Parameters<typeof installPlatform>[0] = {}): Promise<HTMLDivElement> {
  installPlatform(options)
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(createElement(AppShell))
    await Promise.resolve()
  })
  await clickButton(container, 'Settings')
  await clickButton(container, 'Basic Settings')
  return container
}

describe('PLAT-61 基础设置代理说明', () => {
  it('shows the proxy request hint and a proxy self-test that reports success without credentials', async () => {
    const container = await renderBasicSettings({
      settings: {
        ...createDefaultAppSettings(),
        network: { proxyMode: 'custom', proxyUrl: 'http://user:super-secret@127.0.0.1:7888', proxyBypassRules: '' }
      }
    })

    await vi.waitFor(() => expect(container.querySelector('[data-preferences-proxy-hint]')).not.toBeNull())
    expect(container.querySelector('[data-preferences-proxy-hint]')?.textContent).toBe(labels.proxyRequestHint)

    const button = container.querySelector<HTMLButtonElement>('[data-proxy-self-test]')
    expect(button?.textContent?.trim()).toBe(labels.proxySelfTest)
    await act(async () => {
      button?.click()
      await Promise.resolve()
    })

    await vi.waitFor(() => expect(container.querySelector('[data-proxy-self-test-result]')).not.toBeNull())
    const result = container.querySelector('[data-proxy-self-test-result]')
    expect(result?.textContent).toContain('HTTP 200')
    expect(result?.textContent).toContain('http://127.0.0.1:7888')
    // 账号密码绝不出现。
    expect(result?.textContent).not.toContain('super-secret')
    expect(result?.textContent).not.toContain('user:')
  })

  it('reports proxy self-test failures with the classified code and target host', async () => {
    const container = await renderBasicSettings({
      testConnection: async () => ({
        ok: false,
        status: null,
        durationMs: 300,
        reasonCode: 'network_timeout',
        targetHost: 'aihubmix.com'
      })
    })

    const button = container.querySelector<HTMLButtonElement>('[data-proxy-self-test]')
    await act(async () => {
      button?.click()
      await Promise.resolve()
    })

    await vi.waitFor(() => expect(container.querySelector('[data-proxy-self-test-result]')).not.toBeNull())
    expect(container.querySelector('[data-proxy-self-test-result]')?.textContent).toBe(
      labels.proxySelfTestFailed('network_timeout', 'aihubmix.com')
    )
  })

  it('shows the proxy request hint in basic settings', async () => {
    installPlatform()
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(createElement(AppShell))
      await Promise.resolve()
    })
    await clickButton(container, 'Settings')
    await clickButton(container, 'Basic Settings')

    await vi.waitFor(() => expect(container.querySelector('[data-preferences-proxy-hint]')).not.toBeNull())
    expect(container.querySelector('[data-preferences-proxy-hint]')?.textContent).toBe(labels.proxyRequestHint)
  })
})
