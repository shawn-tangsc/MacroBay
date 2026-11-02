// @vitest-environment happy-dom

import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { platformText } from '../../i18n/platformText'

import { renderModelServiceSettings } from './modelServicePageHarness'

/**
 * PLAT-62 / PLAT-81：需代理供应商的详情页说明。
 *
 * 品牌块压成一行后，来源行是 `host · 分类`；模型数量与可达性不在这里重复
 * （前者在下方「模型 N」，后者是独立的「需代理」徽章）；
 * proxy 供应商在**中文界面**额外渲染一个紧凑的「需代理」徽标，完整说明放在 `title` 里。
 * 英文界面 / direct 供应商都不渲染这个徽标。
 */
const zhModels = platformText['zh-CN'].models
const enModels = platformText['en-US'].models
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  document.body.replaceChildren()
})

function proxyNotice(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-mainland-proxy-notice]')
}

describe('PLAT-62 中国大陆代理提示', () => {
  it('shows the proxy hint right after the meta line for a proxy provider in Chinese UI', async () => {
    const page = await renderModelServiceSettings({
      language: 'zh-CN',
      provider: { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com' }
    })

    const source = page.container.querySelector<HTMLElement>('[data-provider-source]')
    const notice = proxyNotice(page.container)
    expect(source).not.toBeNull()
    // 一行 meta 只留 host 与分类：模型数量在下方「模型 N」，可达性由紧随其后的徽章表达。
    expect(source?.textContent).toContain('api.openai.com')
    expect(source?.textContent).toContain(zhModels.providerCategories.international)
    expect(source?.textContent).not.toContain('个模型')
    expect(source?.textContent).not.toContain(zhModels.reachabilityProxy)

    expect(notice).not.toBeNull()
    // R2：品牌块压成一行 ⇒ 完整说明在 title 里，可见文案是紧凑的「需代理」。
    expect(notice?.getAttribute('title')).toBe(zhModels.mainlandProxyNotice)
    expect(notice?.textContent).toContain(zhModels.reachabilityProxy)
    // 仍紧跟在来源行后面（同一品牌块、DOM 顺序紧随其后）。
    expect(source?.nextElementSibling).toBe(notice)
    const order = source !== null && notice !== null ? source.compareDocumentPosition(notice) : 0
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(page.container.querySelector('[data-model-service-brand]')?.contains(notice!)).toBe(true)

    await act(async () => page.root.unmount())
  })

  it('does not render the hint for a proxy provider in English UI', async () => {
    const page = await renderModelServiceSettings({ provider: { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com' } })

    const source = page.container.querySelector<HTMLElement>('[data-provider-source]')
    expect(source?.textContent).not.toContain('models')
    expect(proxyNotice(page.container)).toBeNull()

    await act(async () => page.root.unmount())
  })

  it('does not render the hint for a direct provider in Chinese UI', async () => {
    const page = await renderModelServiceSettings({ language: 'zh-CN' })

    // 默认 fixture 是 silicon（direct）。
    expect(page.container.querySelector('[data-provider-source]')?.textContent?.trim()).toBeTruthy()
    expect(proxyNotice(page.container)).toBeNull()

    await act(async () => page.root.unmount())
  })
})
