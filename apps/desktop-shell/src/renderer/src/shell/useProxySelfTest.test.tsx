// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { platformText } from '../i18n/platformText'

import { PROXY_SELF_TEST_PROBE_URL } from './proxySelfTestDisplay'
import { useProxySelfTest } from './useProxySelfTest'

/**
 * 「测试代理」探的是谁：**固定的 Google 204 端点**，与当前选的是哪个供应商无关。
 *
 * 用户 2026-11-11：「访问一下 google 就说明代理有没有用了」。改之前拿的是供应商 origin
 * （缺省 `https://api.siliconflow.cn/`），根路径 404 就被判成失败，读者看到
 * 「供应商返回 HTTP 404」去查供应商，而代理本身是通的。
 */
const text = platformText['zh-CN']

let root: ReturnType<typeof createRoot> | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  Reflect.deleteProperty(window, 'platform')
})

const settings = {
  network: { proxyMode: 'custom', proxyUrl: 'http://127.0.0.1:7890', proxyBypass: '' }
} as never

type Hook = ReturnType<typeof useProxySelfTest>

async function mount(response: Record<string, unknown>): Promise<Readonly<{ read: () => Hook }>> {
  const testConnection = vi.fn(async () => response)
  ;(window as unknown as { platform: unknown }).platform = { modelProviders: { testConnection } }
  let api: Hook | undefined
  function Probe(): null {
    api = useProxySelfTest({ settings, t: text })
    return null
  }
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => { root!.render(createElement(Probe)) })
  if (api === undefined) throw new Error('hook did not mount')
  // 每次重渲染都会重新给 `api` 赋值：返回值必须是**读最新一次的入口**，不是挂载那一刻的快照。
  return { read: () => api! }
}

describe('测试代理探的是 Google', () => {
  it('hands the fixed probe URL to testConnection, whatever provider is selected', async () => {
    // 钩子已经不再收供应商：目标是个常量，选谁都不影响。
    const api = await mount({
      ok: true,
      status: 204,
      durationMs: 90,
      resolvedProxy: 'PROXY 127.0.0.1:7890',
      proxied: true,
      endpointReachable: true
    })
    await act(async () => { await api.read().runProxySelfTest() })

    const testConnection = (window as unknown as {
      platform: { modelProviders: { testConnection: ReturnType<typeof vi.fn> } }
    }).platform.modelProviders.testConnection
    expect(testConnection).toHaveBeenCalledTimes(1)
    expect(testConnection.mock.calls[0]?.[1]).toEqual({ proxyProbeUrl: PROXY_SELF_TEST_PROBE_URL })
  })

  it('keeps the three evidence lines the result already carried', async () => {
    // 证据链三件回答的是不同问题：解析出来的代理、代理端点通不通、不经代理的对照探针。
    const api = await mount({
      ok: true,
      status: 204,
      durationMs: 90,
      resolvedProxy: 'PROXY 127.0.0.1:7890',
      proxied: true,
      endpointReachable: true,
      proxyEndpoint: '127.0.0.1:7890',
      proxyEndpointLoopback: true,
      directProbeReachable: true
    })
    await act(async () => { await api.read().runProxySelfTest() })

    const result = api.read().proxySelfTest.result
    expect(result?.resolvedProxy).toBe('PROXY 127.0.0.1:7890')
    expect(result?.endpointReachable).toBe(true)
    expect(result?.directProbeReachable).toBe(true)
    expect(result?.status).toBe(204)
  })
})
