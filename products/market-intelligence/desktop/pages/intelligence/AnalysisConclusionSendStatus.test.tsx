// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AnalysisConclusionSendStatus } from './AnalysisConclusionSendStatus'

/**
 * 说明行的判据：
 * - **只在有结果时出现**（发送中由按钮自己说，不设第二个等待指示）；
 * - **正文只有数字、没有通道名，也没有原因码**；
 * - **逐条说明只在 ⓘ 浮层里**：按通道一行「名字 · 人话原因」；没有逐通道行时连图标都不画。
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

const render = (status: Parameters<typeof AnalysisConclusionSendStatus>[0]['status']): void => {
  act(() => root.render(<AnalysisConclusionSendStatus channelsLabel="这次每条通道的结果" status={status} />))
}

const trigger = (): HTMLButtonElement | null => host.querySelector('button[aria-label="这次每条通道的结果"]')

describe('the send status row', () => {
  it('announces the count without any channel name and without a folded code', () => {
    render({
      message: '1 条通道收到，2 条没到',
      channels: [
        { name: 'Telegram', detail: '收到了' },
        { name: '飞书', detail: '通道没接这次请求' },
        { name: 'Discord', detail: '这条通道刚失败过几次，暂时没有重试' }
      ]
    })
    expect(host.querySelector('[role="status"]')?.textContent).toBe('1 条通道收到，2 条没到')
    // 原因码不再有任何位置（折叠区、code 标签都没有了）。
    expect(host.querySelector('details')).toBeNull()
    expect(host.querySelector('code')).toBeNull()
  })

  it('keeps every per-channel reason inside the ⓘ popover, one row per channel', async () => {
    render({
      message: '1 条通道收到，1 条没到',
      channels: [
        { name: 'Telegram', detail: '收到了' },
        { name: '飞书', detail: '通道没接这次请求' }
      ]
    })
    // 收起时一行都不在正文里。
    expect(document.body.querySelector('[data-send-channels]')).toBeNull()
    const button = trigger()
    expect(button).not.toBeNull()
    await act(async () => { button!.click() })
    const list = document.body.querySelector('[data-send-channels]')
    expect(list).not.toBeNull()
    const rows = [...list!.querySelectorAll('li')].map((row) => row.textContent)
    expect(rows).toEqual(['Telegram收到了', '飞书通道没接这次请求'])
  })

  it('draws no ⓘ at all when the receipt has no per-channel rows', () => {
    render({ message: '只留在应用内，没到手机 · 12:44' })
    expect(trigger()).toBeNull()
    expect(host.querySelector('[role="status"]')?.textContent).toBe('只留在应用内，没到手机 · 12:44')
  })
})
