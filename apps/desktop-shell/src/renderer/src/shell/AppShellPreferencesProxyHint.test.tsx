// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDefaultAppSettings } from '@platform/settings/schema/appSettings'

import { platformText } from '../i18n/platformText'
import { AppShell } from './AppShell'
import { installPlatform } from './model-service/modelServicePageHarness'

/**
 * PLAT-61：基础设置 → 代理段的说明（应用请求走这里的代理；浏览器能打开≠应用能连）。
 *
 * 2026-11-09：这句从正文灰字收进**标题旁的 ⓘ**——设置页那一行只许「字段名 / 当前值 / 控件 / 状态」，
 * 说明留在正文里会被读者当成字段读。判据是「真从 DOM 移出」：关闭态下 `container.textContent` 里没有它。
 */
const labels = platformText['en-US'].preferences
const sentences = platformText['en-US'].models

let root: Root | undefined

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

/** 标题旁那颗 ⓘ：读屏名逐字取自文案表（`Proxy settings explanation`）。 */
async function waitForProxyHintButton(container: ParentNode): Promise<HTMLButtonElement> {
  let found: HTMLButtonElement | null = null
  await vi.waitFor(() => {
    found = container.querySelector<HTMLButtonElement>(`button[aria-label="${labels.proxyRequestHintInfo}"]`)
    expect(found).not.toBeNull()
  })
  if (found === null) throw new Error('proxy hint button not found')
  return found
}

describe('PLAT-61 基础设置代理说明', () => {
  it('keeps the proxy request hint behind the title info button, and the self-test reports success without credentials', async () => {
    const container = await renderBasicSettings({
      settings: {
        ...createDefaultAppSettings(),
        network: { proxyMode: 'custom', proxyUrl: 'http://user:super-secret@127.0.0.1:7888', proxyBypassRules: '' }
      }
    })

    const hint = await waitForProxyHintButton(container)
    // 说明句**不在正文里**（不是 CSS 藏起来）：这一行只剩字段名、控件与状态。
    expect(container.textContent).not.toContain(labels.proxyRequestHint)
    expect(hint.getAttribute('aria-describedby')).toBeTruthy()

    const button = container.querySelector<HTMLButtonElement>('[data-proxy-self-test]')
    expect(button?.textContent?.trim()).toBe(labels.proxySelfTest)
    await act(async () => {
      button?.click()
      await Promise.resolve()
    })

    await vi.waitFor(() => expect(container.querySelector('[data-proxy-self-test-result]')).not.toBeNull())
    const result = container.querySelector('[data-proxy-self-test-result]')
    expect(result?.textContent).toContain('HTTP 200')
    // 绿档不再印地址；没确认经过代理时只说「能连到」。
    expect(result?.textContent).toContain(labels.proxySelfTestReachable(200, '1.2'))
    // 自定义模式下拿不到「经代理」的证据：琥珀 partial，不是绿色 pass。
    expect(result?.getAttribute('data-tone')).toBe('partial')
    // 账号密码绝不出现。
    expect(result?.textContent).not.toContain('super-secret')
    expect(result?.textContent).not.toContain('user:')
  })

  it('reports proxy self-test failures in human words without the internal code', async () => {
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
    // 码不进句子；没拿到对照结果时走「连不上代理服务器本身、原因待查」，并给重试一行。
    expect(container.querySelector('[data-proxy-self-test-result]')?.textContent).toBe(
      `${labels.proxySelfTestUnattributable('aihubmix.com')}${labels.proxySelfTestCauseUnknownHint}`
    )
    expect(container.querySelector('[data-proxy-self-test-result]')?.textContent).not.toContain('network_timeout')
  })

  it('keeps the proxy request hint out of the row text in basic settings', async () => {
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

    const hint = await waitForProxyHintButton(container)
    expect(container.textContent).not.toContain(labels.proxyRequestHint)
    // 点开才读得到，句子一词不改——收的是位置，不是改写。
    await act(async () => {
      hint.click()
      await Promise.resolve()
    })
    await vi.waitFor(() => expect(document.body.textContent).toContain(labels.proxyRequestHint))
  })
})
