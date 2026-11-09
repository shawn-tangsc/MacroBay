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
  listAudits: vi.fn(async () => ({
    rows: [{ id: 'a1', action: 'request-enable', actorId: 'me', code: null, createdAt: '2026-11-03T01:00:00.000Z' }]
  })),
  listRuntimeAudits: vi.fn(async () => ({
    rows: [{ id: 'r1', code: 'channel-inbound-failed', createdAt: '2026-11-03T02:00:00.000Z' }],
    nextCursor: null
  })),
  listDeliveryAudits: vi.fn(async () => ({
    rows: [{ id: 'd1', attemptId: 'x', code: 'channel-rejected', createdAt: '2026-11-03T03:00:00.000Z' }]
  }))
}

describe('the channel log panel', () => {
  it('merges the three sources, prefixes each row and keeps the level words', async () => {
    const container = await mount(ok)

    const rows = [...container.querySelectorAll('.channel-log-row')]
    expect(rows).toHaveLength(3)
    const text = container.textContent ?? ''
    expect(text).toContain(`${labels.channelLogOperationPrefix}启用了推送`)
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

  it('explains a mirrored Telegram failure instead of saying "no further explanation"', async () => {
    const container = await mount({
      ...ok,
      listRuntimeAudits: vi.fn(async () => ({
        rows: [
          { id: 't1', code: 'telegram-conflict', createdAt: '2026-11-03T06:00:00.000Z' },
          { id: 't2', code: 'telegram-rate-limited', createdAt: '2026-11-03T05:00:00.000Z' }
        ],
        nextCursor: null
      }))
    })

    const rows = [...container.querySelectorAll('.channel-log-row')]
    const conflict = rows.find((node) => node.textContent?.includes('另一个程序也在用这个机器人'))
    const limited = rows.find((node) => node.textContent?.includes('被平台限流'))
    expect(conflict?.getAttribute('data-log-level')).toBe('ERROR')
    // 频率上限是规则：中性，不画红。
    expect(limited?.getAttribute('data-log-level')).toBe('INFO')
    expect(container.textContent).not.toContain(labels.channelLogsUnknownCode)
    expect(container.textContent).not.toContain('telegram-conflict')
  })

  it('shows connection start and stop as INFO under the runtime prefix, not as errors', async () => {
    const container = await mount({
      ...ok,
      listRuntimeAudits: vi.fn(async () => ({
        rows: [
          { id: 'l1', code: 'channel-runtime-started', createdAt: '2026-11-03T05:00:00.000Z' },
          { id: 'l2', code: 'channel-runtime-stopped', createdAt: '2026-11-03T04:30:00.000Z' }
        ],
        nextCursor: null
      }))
    })

    const rows = [...container.querySelectorAll('.channel-log-row')]
    const started = rows.find((node) => node.textContent?.includes('连接已启动'))
    // 「停了」这一行必须说清是谁停的：读者停用/应用退出，而不是「它自己停了」（后者走自动重试那一行）。
    const stopped = rows.find((node) => node.textContent?.includes('已停用推送'))
    expect(started?.getAttribute('data-log-level')).toBe('INFO')
    expect(stopped?.getAttribute('data-log-level')).toBe('INFO')
    expect(stopped?.textContent).toContain('你停用的')
    // 起停用「运行：」，不是「运行异常：」——它们不是异常。
    expect(started?.textContent).toContain(labels.channelLogLifecyclePrefix)
    expect(started?.textContent).not.toContain(labels.channelLogRuntimePrefix)
  })

  it('names common management actions instead of leaving the fallback sentence', async () => {
    const container = await mount({
      ...ok,
      listAudits: vi.fn(async () => ({
        rows: [{ id: 'a9', action: 'update', actorId: 'me', code: null, createdAt: '2026-11-03T04:00:00.000Z' }]
      }))
    })

    const row = container.querySelector('.channel-log-row')
    expect(row?.textContent).toContain(`${labels.channelLogOperationPrefix}修改了频道设置`)
    expect(row?.textContent).not.toContain(labels.channelLogsUnknownCode)
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
    expect(row?.getAttribute('data-log-level')).toBe('INFO')
    expect(row?.querySelector('.channel-log-level')?.textContent).toBe('[INFO]')
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

  it('writes why an enable attempt failed on the same line, not just that it happened', async () => {
    const container = await mount({
      ...ok,
      listAudits: vi.fn(async () => ({
        rows: [
          { id: 'f1', action: 'request-enable', actorId: 'me', code: 'telegram-conflict', createdAt: '2026-11-03T04:30:00.000Z' },
          { id: 'f2', action: 'request-enable', actorId: 'me', code: null, createdAt: '2026-11-03T04:00:00.000Z' }
        ]
      }))
    })

    const rows = [...container.querySelectorAll('.channel-log-row')]
    const failed = rows.find((node) => node.textContent?.includes('启用没有通过'))
    const enabled = rows.find((node) => node.textContent?.includes('启用了推送'))
    // 失败那行：动作 + 原因，同一行里能看出「为什么没开」。
    expect(failed?.textContent).toContain(`${labels.channelLogOperationPrefix}${labels.channelLogEnableFailedPrefix}`)
    expect(failed?.textContent).toContain(labels.channelFailureReason['telegram-conflict'])
    expect(failed?.textContent).not.toContain(labels.channelLogsUnknownCode)
    expect(failed?.textContent).not.toContain('telegram-conflict')
    // 成功那行不带 code，仍只说动作。
    expect(enabled?.textContent).toContain(`${labels.channelLogOperationPrefix}${labels.channelLogActionText.actionRequestEnable}`)
    expect(enabled?.textContent).not.toContain(labels.channelLogEnableFailedPrefix)
  })

  it('keeps an unknown enable-failure code off the screen and says why it cannot be more specific', async () => {
    const container = await mount({
      ...ok,
      listAudits: vi.fn(async () => ({
        rows: [{ id: 'f3', action: 'request-enable', actorId: 'me', code: 'some-new-code', createdAt: '2026-11-03T04:30:00.000Z' }]
      }))
    })

    const row = container.querySelector('.channel-log-row')
    expect(row?.textContent).toContain(labels.channelFailureReasonUnknown)
    expect(row?.textContent).not.toContain('some-new-code')
    expect(row?.textContent).not.toContain('没有上报')
  })

  it('does not file an unconfirmed send under failures', async () => {
    const container = await mount({
      ...ok,
      listDeliveryAudits: vi.fn(async () => ({
        rows: [{ id: 'd2', attemptId: 'x', code: 'unknown-after-send', createdAt: '2026-11-03T03:00:00.000Z' }]
      }))
    })

    const text = container.textContent ?? ''
    expect(text).toContain(labels.channelLogUncertainPrefix)
    expect(text).not.toContain(labels.channelLogDeliveryPrefix)
    expect(container.querySelector('.channel-log-level')?.textContent).toBe('[WARN]')
  })

  it('says there are no records yet, without offering a copy action', async () => {
    const container = await mount({
      listAudits: vi.fn(async () => ({ rows: [] })),
      listRuntimeAudits: vi.fn(async () => ({ rows: [], nextCursor: null })),
      listDeliveryAudits: vi.fn(async () => ({ rows: [] }))
    })

    expect(container.textContent).toContain(labels.channelLogsEmptyTitle)
    // 说明句不在正文里：空态只留状态行 + 标题那颗 ⓘ。
    expect(container.textContent).not.toContain(labels.channelLogsEmptyHint)
    expect(container.querySelector(`button[aria-label="${labels.channelLogsFooterInfo}"]`)).not.toBeNull()
    expect(container.querySelector('.channel-log-toolbar')).toBeNull()
  })

  it('says the read failed, not that there are no records, and offers a retry', async () => {
    const container = await mount({
      listAudits: vi.fn(async () => { throw new Error('ipc') }),
      listRuntimeAudits: vi.fn(async () => ({ rows: [], nextCursor: null })),
      listDeliveryAudits: vi.fn(async () => ({ rows: [] }))
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

describe('a failed send names its reason instead of saying "no further explanation"', () => {
  it.each([
    ['delivery-provider-rejected'],
    ['delivery-target-invalid']
  ])('translates %s', async (code) => {
    const container = await mount({
      ...ok,
      listDeliveryAudits: vi.fn(async () => ({
        rows: [{ id: 'd9', attemptId: 'x', code, createdAt: '2026-11-04T09:06:38.000Z' }]
      }))
    })

    const text = container.textContent ?? ''
    expect(text).toContain(labels.channelLogDeliveryPrefix)
    expect(text).toContain(labels.channelLogDeliveryText[code])
    // 有具体码就不许落回「没有更多说明」，原始码也不上屏。
    expect(text).not.toContain(labels.channelLogsUnknownCode)
    expect(text).not.toContain(code)
  })

  it('keeps the bare status code only as a fallback, worded as a fallback', async () => {
    const container = await mount({
      ...ok,
      listDeliveryAudits: vi.fn(async () => ({
        rows: [{ id: 'd10', attemptId: 'x', code: 'channel-delivery-failed', createdAt: '2026-11-04T09:06:38.000Z' }]
      }))
    })

    const text = container.textContent ?? ''
    expect(text).toContain(labels.channelLogDeliveryText['channel-delivery-failed'])
    // 兜底句自己要说清「没有记录」，不假装是解释。
    expect(labels.channelLogDeliveryText['channel-delivery-failed']).toContain('没有记录')
  })
})

describe('the platform\'s own words ride along as a note, never as the reason', () => {
  it('keeps the human sentence first and appends the detail in brackets', async () => {
    const container = await mount({
      ...ok,
      listDeliveryAudits: vi.fn(async () => ({
        rows: [
          {
            id: 'd11',
            attemptId: 'x',
            code: 'delivery-provider-rejected',
            detail: 'Bad Request: chat not found',
            createdAt: '2026-11-04T09:06:38.000Z'
          }
        ]
      }))
    })

    const row = [...container.querySelectorAll('.channel-log-row')].find((node) =>
      node.textContent?.includes(labels.channelLogDeliveryPrefix)
    )
    const text = row?.textContent ?? ''
    // 主句还是人话；原话在括号里补充。
    expect(text).toContain(labels.channelLogDeliveryText['delivery-provider-rejected'])
    expect(text).toContain('（Bad Request: chat not found）')
    expect(text.indexOf(labels.channelLogDeliveryText['delivery-provider-rejected'])).toBeLessThan(
      text.indexOf('Bad Request: chat not found')
    )
  })

  it('treats a host that was never started as neutral, with the by-rule prefix', async () => {
    // 「通道宿主没在运行」是规则（没试过），不是这次发送失败：中性 + 一句能做什么。
    const container = await mount({
      ...ok,
      listDeliveryAudits: vi.fn(async () => ({
        rows: [{ id: 'd14', attemptId: 'x', code: 'delivery-host-unavailable', detail: null, createdAt: '2026-11-04T09:06:38.000Z' }]
      }))
    })
    const row = container.querySelector('[data-log-level]')
    expect(row?.getAttribute('data-log-level')).toBe('INFO')
    expect(container.textContent ?? '').toContain(labels.channelLogByRulePrefix)
    expect(container.textContent ?? '').toContain(labels.channelLogDeliveryText['delivery-host-unavailable'])
  })

  it('paints a rule-held send as INFO with its own prefix, never as a red failure', async () => {
    // 「被平台限流」是规则挡下、会自动重试：它没有错，画成红故障会让读者去查一个不存在的坏通道。
    const container = await mount({
      ...ok,
      listDeliveryAudits: vi.fn(async () => ({
        rows: [{ id: 'd13', attemptId: 'x', code: 'delivery-rate-limited', createdAt: '2026-11-04T09:06:38.000Z' }]
      }))
    })
    const row = container.querySelector('[data-log-level]')
    expect(row?.getAttribute('data-log-level')).toBe('INFO')
    const text = container.textContent ?? ''
    expect(text).toContain(labels.channelLogByRulePrefix)
    expect(text).toContain(labels.channelLogDeliveryText['delivery-rate-limited'])
    expect(text).not.toContain(labels.channelLogDeliveryPrefix)
  })

  it('draws no brackets when there is nothing to append', async () => {
    const container = await mount({
      ...ok,
      listDeliveryAudits: vi.fn(async () => ({
        rows: [{ id: 'd12', attemptId: 'x', code: 'delivery-rate-limited', detail: null, createdAt: '2026-11-04T09:06:38.000Z' }]
      }))
    })

    const text = container.textContent ?? ''
    expect(text).toContain(labels.channelLogDeliveryText['delivery-rate-limited'])
    expect(text).not.toContain('（）')
  })
})

describe('the failure list never paints a success as a failure', () => {
  it('shows only the failed send when the audits also carry a delivered one', async () => {
    const container = await mount({
      ...ok,
      listDeliveryAudits: vi.fn(async () => ({
        rows: [
          { id: 'd21', attemptId: 'x', code: 'channel-delivery-delivered', detail: null, createdAt: '2026-11-04T10:38:21.000Z' },
          { id: 'd22', attemptId: 'y', code: 'delivery-provider-rejected', detail: 'Bad Request: chat not found', createdAt: '2026-11-04T10:38:26.000Z' }
        ]
      }))
    })

    const deliveryRows = [...container.querySelectorAll('.channel-log-row')].filter((node) =>
      node.textContent?.includes(labels.channelLogDeliveryPrefix)
    )
    expect(deliveryRows).toHaveLength(1)
    expect(deliveryRows[0]?.textContent).toContain(labels.channelLogDeliveryText['delivery-provider-rejected'])
    // 成功那条一个红条都不许带，连行都不出现。
    expect(container.textContent).not.toContain('channel-delivery-delivered')
    expect(container.textContent).not.toContain(labels.channelLogsUnknownCode)
  })

  it('drops an unrecognised delivery code instead of guessing that it failed', async () => {
    const container = await mount({
      ...ok,
      listDeliveryAudits: vi.fn(async () => ({
        rows: [{ id: 'd23', attemptId: 'z', code: 'delivery-something-new', detail: null, createdAt: '2026-11-04T10:38:26.000Z' }]
      }))
    })

    // 表里没有话的码：不上屏。猜错的方向恰好是「把成功说成失败」。
    expect(container.textContent).not.toContain(labels.channelLogDeliveryPrefix)
    expect(container.textContent).not.toContain(labels.channelLogsUnknownCode)
    expect(container.textContent).not.toContain('delivery-something-new')
  })
})
