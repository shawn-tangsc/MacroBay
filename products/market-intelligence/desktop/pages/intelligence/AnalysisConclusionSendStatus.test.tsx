// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AnalysisConclusionSendStatus } from './AnalysisConclusionSendStatus'

/**
 * 说明行的两条判据：**只在有结果时出现**（发送中由按钮自己说，不设第二个等待指示），
 * 以及**原因码只在这一个折叠区、默认收起**。
 */
let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const render = (status: { message: string; reasonCode?: string }): void => {
  act(() => root.render(<AnalysisConclusionSendStatus reasonLabel="原因码" status={status} />))
}

describe('the send status row', () => {
  it('announces the result without a folded item when there is no code', () => {
    render({ message: '今天的上限到了（每天 4 条），明天再发' })
    const line = host.querySelector('[role="status"]')
    expect(line?.textContent).toBe('今天的上限到了（每天 4 条），明天再发')
    expect(host.querySelector('details')).toBeNull()
  })

  it('keeps the reason code in exactly one folded item, closed by default', () => {
    render({ message: '没发到手机：还没有可用的通道，去「频道」启用一条', reasonCode: 'push-unavailable' })
    const items = host.querySelectorAll('details')
    expect(items).toHaveLength(1)
    expect(items[0]!.hasAttribute('open')).toBe(false)
    expect(items[0]!.querySelector('summary')?.textContent).toBe('原因码')
    expect(items[0]!.querySelector('code')?.textContent).toBe('push-unavailable')
    // 主句里没有码：码只在这一处。
    expect(host.querySelector('[role="status"]')?.textContent).not.toContain('push-unavailable')
  })
})
