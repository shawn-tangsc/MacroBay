// @vitest-environment happy-dom

import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import type { ProviderChatEndpoint } from '@platform/ai/providers/modelProviderTypes'
import { platformText } from '../../i18n/platformText'
import { renderModelServiceSettings } from './modelServicePageHarness'

/**
 * T4/T5：请求配置抽屉里的**默认端点**。
 *
 * 形态（用户确认）：端点清单的顺序就是优先级 —— `endpoints[0]` 是默认端点。
 * 每个已配置的端点行头自带标记：默认 ⇒ 灰色「默认」徽章（不可点）；其余 ⇒ 「设为默认」按钮
 * （改动即存：把该端点移到清单头部）。删除一个端点 ⇒ 剩下的第一条自动成为默认。
 */
const labels = platformText['en-US'].models

afterEach(() => {
  document.body.replaceChildren()
  Reflect.deleteProperty(window, 'platform')
})

async function openDrawer(container: HTMLElement): Promise<void> {
  await act(async () => {
    container.querySelector<HTMLElement>('[data-request-config-open]')?.click()
    await Promise.resolve()
  })
}

/** 抽屉写入的载荷 = 整份端点清单（`[0]` = 默认端点）。 */
function savedEndpoints(call: unknown): ProviderChatEndpoint[] {
  return (call as { endpoints: ProviderChatEndpoint[] }).endpoints
}

describe('T4/T5 default endpoint in the request config drawer', () => {
  it('shows the default badge on the first endpoint only', async () => {
    const page = await renderModelServiceSettings({
      provider: {
        endpoints: [
          { protocol: 'chat-completions', baseUrl: 'https://api.siliconflow.cn' },
          { protocol: 'responses', baseUrl: 'https://responses.test' }
        ]
      }
    })
    await openDrawer(page.container)

    expect(document.querySelector('[data-endpoint-default-badge="chat-completions"]')?.textContent)
      .toBe(labels.endpointDefaultBadge)
    expect(document.querySelector('[data-endpoint-set-default="chat-completions"]')).toBeNull()
    expect(document.querySelector('[data-endpoint-set-default="responses"]')?.textContent)
      .toBe(labels.endpointSetDefault)

    await act(async () => page.root.unmount())
  })

  it('persists the chosen endpoint by moving it to the front of the list', async () => {
    const page = await renderModelServiceSettings({
      provider: {
        endpoints: [
          { protocol: 'chat-completions', baseUrl: 'https://api.siliconflow.cn' },
          { protocol: 'responses', baseUrl: 'https://responses.test' }
        ]
      }
    })
    await openDrawer(page.container)

    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-endpoint-set-default="responses"]')?.click()
      await Promise.resolve()
    })

    expect(page.api.upsert).toHaveBeenCalledTimes(1)
    expect(savedEndpoints(page.api.upsert.mock.calls[0]?.[0])).toEqual([
      { protocol: 'responses', baseUrl: 'https://responses.test' },
      { protocol: 'chat-completions', baseUrl: 'https://api.siliconflow.cn' }
    ])

    await act(async () => page.root.unmount())
  })

  it('deletes a non-default endpoint without touching the default', async () => {
    const page = await renderModelServiceSettings({
      provider: {
        endpoints: [
          { protocol: 'responses', baseUrl: 'https://r.test' },
          { protocol: 'chat-completions', baseUrl: 'https://api.siliconflow.cn' },
          { protocol: 'gemini', baseUrl: 'https://g.test' }
        ]
      }
    })
    await openDrawer(page.container)

    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-endpoint-delete="gemini"]')?.click()
      await Promise.resolve()
    })

    expect(savedEndpoints(page.api.upsert.mock.calls[0]?.[0])).toEqual([
      { protocol: 'responses', baseUrl: 'https://r.test' },
      { protocol: 'chat-completions', baseUrl: 'https://api.siliconflow.cn' }
    ])

    await act(async () => page.root.unmount())
  })

  it('falls back to the next endpoint when the current default is removed', async () => {
    const page = await renderModelServiceSettings({
      provider: {
        endpoints: [
          { protocol: 'responses', baseUrl: 'https://responses.test' },
          { protocol: 'chat-completions', baseUrl: 'https://api.siliconflow.cn' }
        ]
      }
    })
    await openDrawer(page.container)
    expect(document.querySelector('[data-endpoint-default-badge="responses"]')?.textContent)
      .toBe(labels.endpointDefaultBadge)

    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-endpoint-delete="responses"]')?.click()
      await Promise.resolve()
    })

    // 删掉默认端点 ⇒ 剩下的第一条自动成为默认（绝不留空的默认）。
    expect(savedEndpoints(page.api.upsert.mock.calls[0]?.[0])).toEqual([
      { protocol: 'chat-completions', baseUrl: 'https://api.siliconflow.cn' }
    ])

    await act(async () => page.root.unmount())
  })
})
