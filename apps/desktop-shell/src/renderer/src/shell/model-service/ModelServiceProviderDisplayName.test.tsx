// @vitest-environment happy-dom

import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { platformText } from '../../i18n/platformText'
import { renderModelServiceSettings } from './modelServicePageHarness'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const labels = platformText['zh-CN'].models

afterEach(() => {
  document.body.replaceChildren()
  Reflect.deleteProperty(window, 'platform')
})

async function typeSearch(container: HTMLElement, value: string): Promise<void> {
  const input = container.querySelector<HTMLInputElement>('[data-provider-search]')
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
    input?.dispatchEvent(new Event('input', { bubbles: true }))
    await Promise.resolve()
  })
}

describe('PLAT-62 provider display names in model service', () => {
  it('shows the Chinese display name in rail and detail title and searches both names', async () => {
    const page = await renderModelServiceSettings({ language: 'zh-CN' })

    expect(page.container.querySelector('[data-provider-row="silicon"] .model-service-rail-name')?.textContent)
      .toBe('硅基流动')
    expect(page.container.querySelector('.model-service-title')?.textContent).toBe('硅基流动')

    await typeSearch(page.container, '硅基')
    expect(page.container.querySelector('[data-provider-row="silicon"]')).not.toBeNull()

    await typeSearch(page.container, 'silicon')
    expect(page.container.querySelector('[data-provider-row="silicon"]')).not.toBeNull()

    await typeSearch(page.container, '不存在')
    expect(page.container.querySelector('[data-provider-row="silicon"]')).toBeNull()

    await act(async () => page.root.unmount())
  })
  it('renders TokenRhythm with Chinese name, empty model state and endpoint previews', async () => {
    const page = await renderModelServiceSettings({
      language: 'zh-CN',
      provider: {
        id: 'tokenrhythm',
        name: 'TokenRhythm',
        baseUrl: 'https://tokenrhythm.studio',
        models: []
      }
    })

    expect(page.container.querySelector('.model-service-title')?.textContent).toBe('基元律动')
    expect(page.container.querySelector('[data-models-count]')?.textContent).toBe('0')
    expect(page.container.querySelector('.model-service-empty')?.textContent).toBe('还没有模型')
    expect(page.container.querySelector('[data-models-sync]')?.hasAttribute('disabled')).toBe(false)
    // R3：折叠摘要是「一个只读主 base + 已启用端点小标签」，不再并排多段 URL。
    expect(page.container.querySelector<HTMLInputElement>('[data-endpoint-summary-input]')?.value)
      .toBe('https://tokenrhythm.studio')
    // T4/T5：标签是端点种类（Chat / Anthropic Messages），不是笼统的协议名。
    const tags = [...page.container.querySelectorAll('[data-endpoint-summary-tag]')]
    expect(tags.map((node) => node.getAttribute('data-endpoint-summary-tag'))).toEqual(['chat-completions', 'messages'])
    expect(tags.map((node) => node.textContent)).toEqual([
      `${labels.endpointKindChat}${labels.endpointDefaultBadge}`,
      labels.endpointKindMessages
    ])

    await act(async () => page.root.unmount())
  })

})
