// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { CrossAssetConnectionTest } from './CrossAssetConnectionTest'
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const text = { market: '跨市场行情', pending: '测试中', passed: '通过', partial: '部分通过', failed: '失败', busy: '忙碌', limited: '受限', unavailable: '不可用', rest: '历史', ws: '实时', assets: { index: '纳斯达克 100', btc: 'BTC', eth: 'ETH' }, visibility: '行情在看板可见时实时更新' }

describe('cross-asset capability connection result', () => {
  it('starts only after the existing test action and cancels its own observation on unmount', async () => {
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    const client = { testInterface: vi.fn(async () => ({ state: 'partial', testedAt: Date.now(), assets: { index: { rest: true, ws: false }, btc: { rest: true, ws: true }, eth: { rest: true, ws: true } } })), cancelInterfaceTest: vi.fn(async () => ({ state: 'cancelled' })) }
    await act(async () => root.render(createElement(CrossAssetConnectionTest, { client: client as never, text, requestId: 0 })))
    expect(client.testInterface).not.toHaveBeenCalled()
    await act(async () => root.render(createElement(CrossAssetConnectionTest, { client: client as never, text, requestId: 1 })))
    expect(client.testInterface).toHaveBeenCalledOnce()
    expect(host.textContent).toContain('部分通过')
    expect(host.textContent).toContain('纳斯达克 100')
    expect(host.querySelector('button')).toBeNull()
    await act(async () => root.unmount())
    expect(client.cancelInterfaceTest).toHaveBeenCalledOnce()
    host.remove()
  })
})
