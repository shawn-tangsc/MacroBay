// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'

import { platformText } from '../../../i18n/platformText'
import { ChannelLogsPanel } from './ChannelLogsPanel'

const labels = platformText['zh-CN'].settings
let root: Root | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

async function mount(client: Parameters<typeof ChannelLogsPanel>[0]['client']): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(
      createElement(ShellTimeZoneProvider, {
        timeZone: 'Asia/Shanghai',
        children: createElement(ChannelLogsPanel, {
          channelId: 'channel-1',
          client,
          labels,
          onClose: () => undefined,
          platformName: 'Telegram'
        })
      })
    )
  })
  // 读失败要等 Promise.all 的 rejection 落地：多走一拍再断言。
  await act(async () => {})
  await act(async () => {})
  // 平台 Modal 渲染在 portal 里：断言读 document.body，别读挂载节点。
  return document.body
}

const ok = {
  listAudits: vi.fn(async () => [{ id: 'a1', action: 'enable', actorId: 'me', code: null, createdAt: '2026-11-03T01:00:00.000Z' }]),
  listRuntimeAudits: vi.fn(async () => ({
    rows: [{ id: 'r1', code: 'channel-inbound-failed', createdAt: '2026-11-03T02:00:00.000Z' }],
    nextCursor: null
  })),
  listDeliveryAudits: vi.fn(async () => [{ id: 'd1', attemptId: 'x', code: 'channel-rejected', createdAt: '2026-11-03T03:00:00.000Z' }])
}

describe('the channel log panel', () => {
  it('merges the three sources, prefixes each row and keeps the level words', async () => {
    const container = await mount(ok)

    const rows = [...container.querySelectorAll('.channel-log-row')]
    expect(rows).toHaveLength(3)
    const text = container.textContent ?? ''
    expect(text).toContain(`${labels.channelLogOperationPrefix}开启了推送`)
    expect(text).toContain(`${labels.channelLogRuntimePrefix}收到的消息没能处理成功`)
    expect(text).toContain(`${labels.channelLogDeliveryPrefix}通道拒收了这条`)
    expect(rows[0]?.querySelector('.channel-log-level')?.textContent).toBe('[ERROR]')
  })

  it('declares the zone once and never writes a raw code or a bare GMT offset', async () => {
    const container = await mount({
      ...ok,
      listRuntimeAudits: vi.fn(async () => ({ rows: [{ id: 'r2', code: 'some-new-code', createdAt: '2026-11-03T02:00:00.000Z' }], nextCursor: null }))
    })

    const text = container.textContent ?? ''
    expect(text).toContain(labels.channelLogsUnknownCode)
    expect(text).not.toContain('some-new-code')
    // 时区由标签算出来，写进标题那一行；行内只留时刻。
    expect(container.querySelector('.channel-log-tz')?.textContent).toContain('GMT+8')
    expect(container.querySelector('.channel-log-row')?.textContent).not.toContain('GMT')
  })

  it('files a mention-less group message as a warning, not a failure', async () => {
    const container = await mount({
      ...ok,
      listRuntimeAudits: vi.fn(async () => ({
        rows: [{ id: 'r3', code: 'channel-mention-required', createdAt: '2026-11-03T02:00:00.000Z' }],
        nextCursor: null
      }))
    })

    const row = [...container.querySelectorAll('.channel-log-row')].find((node) =>
      node.textContent?.includes('群里没有 @ 机器人')
    )
    // 群里没 @ 机器人是「按规则忽略」，不是故障：WARN + 可读说明，不能写「没有更多说明」。
    expect(row?.getAttribute('data-log-level')).toBe('WARN')
    expect(row?.querySelector('.channel-log-level')?.textContent).toBe('[WARN]')
    expect(row?.textContent).toContain('群里没有 @ 机器人，已按规则忽略')
    expect(row?.textContent).not.toContain(labels.channelLogsUnknownCode)
  })

  it('treats an unknown runtime code as a warning, never as a failure', async () => {
    const container = await mount({
      ...ok,
      listRuntimeAudits: vi.fn(async () => ({
        rows: [{ id: 'r4', code: 'some-new-code', createdAt: '2026-11-03T02:00:00.000Z' }],
        nextCursor: null
      }))
    })

    const row = [...container.querySelectorAll('.channel-log-row')].find((node) =>
      node.textContent?.includes(labels.channelLogsUnknownCode)
    )
    expect(row?.getAttribute('data-log-level')).toBe('WARN')
    expect(row?.textContent).toContain(labels.channelLogsUnknownCode)
    expect(row?.textContent).not.toContain('some-new-code')
  })

  it('does not file an unconfirmed send under failures', async () => {
    const container = await mount({
      ...ok,
      listDeliveryAudits: vi.fn(async () => [{ id: 'd2', attemptId: 'x', code: 'unknown-after-send', createdAt: '2026-11-03T03:00:00.000Z' }])
    })

    const text = container.textContent ?? ''
    expect(text).toContain(labels.channelLogUncertainPrefix)
    expect(text).not.toContain(labels.channelLogDeliveryPrefix)
    expect(container.querySelector('.channel-log-level')?.textContent).toBe('[WARN]')
  })

  it('says there are no records yet, without offering a copy action', async () => {
    const container = await mount({
      listAudits: vi.fn(async () => []),
      listRuntimeAudits: vi.fn(async () => ({ rows: [], nextCursor: null })),
      listDeliveryAudits: vi.fn(async () => [])
    })

    expect(container.textContent).toContain(labels.channelLogsEmptyTitle)
    expect(container.textContent).toContain(labels.channelLogsEmptyHint)
    expect(container.querySelector('.channel-log-toolbar')).toBeNull()
  })

  it('says the read failed, not that there are no records, and offers a retry', async () => {
    const container = await mount({
      listAudits: vi.fn(async () => { throw new Error('ipc') }),
      listRuntimeAudits: vi.fn(async () => ({ rows: [], nextCursor: null })),
      listDeliveryAudits: vi.fn(async () => [])
    })

    expect(container.textContent).toContain(labels.channelLogsReadFailed)
    expect(container.textContent).not.toContain(labels.channelLogsEmptyTitle)
    // antd 会在两个中文字之间插一个空格，比较前先去掉所有空白。
    const retry = [...container.querySelectorAll('button')].some(
      (node) => node.textContent?.replace(/\s/gu, '') === labels.channelLogsRetry
    )
    expect(retry).toBe(true)
  })
})
