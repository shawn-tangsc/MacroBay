import { describe, expect, it } from 'vitest'

import {
  createChannelPushPort,
  formatPushText,
  mapChannelDeliveryResult,
  type ChannelPushPortDeps
} from './channelPushPort'
import type {
  ChannelConversationSafeView,
  ChannelDeliveryTargetView,
  ChannelManagementSafeView
} from '../../ai/agent-platform/channels/ChannelManagementContracts'
import type { ChannelDeliveryRequest, ChannelDeliveryResult } from '../../ai/agent-platform/channels/ChannelDeliveryContracts'
import type { NotificationRecord } from '../contracts/notificationContracts'
import { notificationCopy } from '../../i18n/notificationCopy'
import type { NotificationDeliveryContent } from '../runtime/notificationRouting'

// 记录 id 用**真实形状**：`createNotificationId()` 生成的是 `notification-<时间戳>-<序号>`。
// 旧夹具写的是 `abcd1234-…`，所以 `#shortId` 看起来像有用信息，掩盖了「每条都是 #notifica」这个 bug。
const RECORD = {
  id: 'notification-1793875279820-1',
  owner: 'platform',
  sourceId: 'job-run',
  eventTypeId: 'platform.job.failed-terminal',
  delivery: { push: { state: 'queued', at: '2026-11-03T00:00:00.000Z' } },
  titleKey: 'notification.taskFailed.title',
  severity: 'info',
  priority: 'normal',
  channels: ['center', 'desktop'],
  state: 'unread',
  actions: [],
  dedupeKey: 'job-failed:run-1',
  occurrenceCount: 1,
  createdAt: '2026-11-03T00:00:00.000Z',
  updatedAt: '2026-11-03T00:00:00.000Z'
} satisfies NotificationRecord

const CONTENT: NotificationDeliveryContent = {
  title: '日报已生成',
  body: '10 月 31 日的情报日报已经生成。',
  reason: '日报生成完成',
  actionLabels: {}
}

function channel(patch: Partial<ChannelManagementSafeView> = {}): ChannelManagementSafeView {
  return {
    id: 'channel-a',
    type: 'telegram',
    name: 'Telegram',
    agentId: 'agent-a',
    workspace: { type: 'system' },
    allowedChatIds: [],
    permissionMode: null,
    requestedEnabled: true,
    state: 'runtime-ready',
    credential: { status: 'configured', hasCredential: true, revision: 1, maskedFields: {} },
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...patch
  }
}

function targetView(patch: Partial<ChannelDeliveryTargetView> = {}): ChannelDeliveryTargetView {
  return { id: 'channel-a', name: 'Telegram', deliverable: true, reason: null, target: { kind: 'bound', conversationKind: 'direct' }, ...patch }
}

function conversation(patch: Partial<ChannelConversationSafeView> = {}): ChannelConversationSafeView {
  return { id: 'conversation-1', kind: 'direct', hasBoundSession: true, targetEnabled: true, sessionTitle: null, createdAt: '2026-11-01T00:00:00.000Z', ...patch }
}

function harness(options: {
  channelId?: string | null
  channels?: readonly ChannelManagementSafeView[]
  target?: ChannelDeliveryTargetView | undefined
  conversations?: readonly ChannelConversationSafeView[]
  result?: ChannelDeliveryResult
  throws?: boolean
  diagnostics?: ChannelPushPortDeps['diagnostics']
}) {
  const requests: ChannelDeliveryRequest[] = []
  const deps: ChannelPushPortDeps = {
    channels: {
      list: () => options.channels ?? [channel()],
      listDeliveryTargets: () => ({ channels: options.target === undefined ? [targetView()] : [options.target] }),
      listConversations: () => options.conversations ?? [conversation()]
    },
    deliver: async (request) => {
      requests.push(request)
      if (options.throws) throw new Error('transport exploded')
      return options.result ?? { status: 'delivered', attemptId: 'attempt-1', errorCode: null }
    },
    settings: { pushChannelId: async () => (options.channelId === undefined ? 'channel-a' : options.channelId) },
    ...(options.diagnostics === undefined ? {} : { diagnostics: options.diagnostics })
  }
  return { push: createChannelPushPort(deps), requests }
}

describe('channelPushPort', () => {
  it('sends one text to the single enabled target and returns the channel evidence id', async () => {
    const { push, requests } = harness({})
    const result = await push(RECORD, CONTENT)

    expect(result).toEqual({ ok: true, messageId: 'attempt-1' })
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      channelId: 'channel-a',
      agentId: 'agent-a',
      conversationId: 'conversation-1',
      source: 'notification',
      sourceId: RECORD.id
    })
    expect(requests[0].text).toContain('日报已生成')
    expect(requests[0].text).toContain(CONTENT.body)
    expect(requests[0].text).toContain('日报生成完成')
    // 正文末尾不再有编号：`#${id 前 8 位}` 在每条上都一样（记录 id 都以 `notification-` 开头）。
    expect(requests[0].text).not.toContain('#')
    expect(requests[0].text).not.toContain('notification-')
    expect(requests[0].text.trimEnd().endsWith('日报生成完成')).toBe(true)
  })

  it('两条不同记录推出去的文字不会因为编号相同而看起来一样', async () => {
    const { push, requests } = harness({})
    const second = { ...RECORD, id: 'notification-1793875279821-2' }

    await push(RECORD, CONTENT)
    await push(second, { ...CONTENT, title: '模块信号触发', body: '有一条新信号，点开看该模块的读数。' })

    const [first, other] = requests.map((request) => request.text)
    expect(first).not.toEqual(other)
    // 旧行为：两条的结尾都是同一个 `#notifica`，看起来像「编号一样、内容没变」。
    for (const text of [first ?? '', other ?? '']) {
      expect(text).not.toContain('#')
      expect(text).not.toContain('notifica')
    }
  })

  it('reports push-unavailable when no channel is selected', async () => {
    const { push, requests } = harness({ channelId: null })
    expect(await push(RECORD, CONTENT)).toEqual({ ok: false, reason: 'push-unavailable' })
    expect(requests).toHaveLength(0)
  })

  it('reports channel-rejected when the selected channel no longer exists', async () => {
    const { push, requests } = harness({ channels: [] })
    expect(await push(RECORD, CONTENT)).toEqual({ ok: false, reason: 'channel-rejected' })
    expect(requests).toHaveLength(0)
  })

  it('maps the two unbound shapes to delivery-no-target-bound and the rest to channel-rejected', async () => {
    const unbound = harness({ target: targetView({ deliverable: false, reason: 'no-enabled-target', target: { kind: 'unbound' } }) })
    expect(await unbound.push(RECORD, CONTENT)).toEqual({ ok: false, reason: 'delivery-no-target-bound' })

    const notEnabled = harness({ target: targetView({ deliverable: false, reason: 'not-enabled', target: { kind: 'unbound' } }) })
    expect(await notEnabled.push(RECORD, CONTENT)).toEqual({ ok: false, reason: 'channel-rejected' })

    expect(unbound.requests).toHaveLength(0)
    expect(notEnabled.requests).toHaveLength(0)
  })

  it('does not count disabled targets or conversations without a bound session', async () => {
    const { push, requests } = harness({
      conversations: [
        conversation({ id: 'stale-1', targetEnabled: false }),
        conversation({ id: 'stale-2', hasBoundSession: false })
      ]
    })
    expect(await push(RECORD, CONTENT)).toEqual({ ok: false, reason: 'delivery-no-target-bound' })
    expect(requests).toHaveLength(0)
  })

  it('refuses to pick a recipient when more than one enabled target is bound', async () => {
    const { push, requests } = harness({
      conversations: [conversation({ id: 'conversation-1' }), conversation({ id: 'conversation-2' })]
    })
    expect(await push(RECORD, CONTENT)).toEqual({ ok: false, reason: 'delivery-ambiguous-target' })
    expect(requests).toHaveLength(0)
  })

  it('maps every channel-layer skip code onto one of the six push reasons', async () => {
    const cases: Array<[string | null, string]> = [
      ['delivery-target-disabled', 'delivery-no-target-bound'],
      ['delivery-owner-invalid', 'delivery-no-target-bound'],
      ['delivery-retry-not-permitted', 'push-backoff'],
      ['delivery-not-authorized', 'channel-rejected'],
      ['delivery-empty-output', 'channel-rejected'],
      [null, 'channel-rejected']
    ]
    for (const [errorCode, reason] of cases) {
      const { push } = harness({ result: { status: 'skipped', attemptId: null, errorCode } })
      expect(await push(RECORD, CONTENT)).toEqual({ ok: false, reason })
    }
  })

  it('keeps unknown-after-send as its own reason instead of calling it a failure', async () => {
    const { push } = harness({ result: { status: 'unknown-after-send', attemptId: 'attempt-2', errorCode: 'delivery-transport-unknown' } })
    expect(await push(RECORD, CONTENT)).toEqual({ ok: false, reason: 'unknown-after-send' })
  })

  it('never lets a transport error escape into the submit path', async () => {
    const { push, requests } = harness({ throws: true })
    await expect(push(RECORD, CONTENT)).resolves.toEqual({ ok: false, reason: 'channel-rejected' })
    expect(requests).toHaveLength(1)
  })

  it('builds the text from the runtime content only, and appends no id', () => {
    expect(formatPushText({ ...CONTENT, body: '' })).toBe('日报已生成\n\n日报生成完成')
    // 标题与正文相同时不重复印两遍。
    expect(formatPushText({ ...CONTENT, body: '日报已生成' })).toBe('日报已生成\n\n日报生成完成')
    // 末尾不是编号：以前这里跟着记录 id 前 8 位，而它每条都一样。
    expect(formatPushText(CONTENT).startsWith('#')).toBe(false)
    expect(formatPushText(CONTENT)).not.toContain('notification-')
  })

  it('puts the original link in the last block, and only once', () => {
    const url = 'https://example.com/news/42'
    const blocks = formatPushText(CONTENT, url).split('\n\n')
    expect(blocks.at(-1)).toBe(url)
    expect(formatPushText(CONTENT, url).split(url)).toHaveLength(2)
    // 某一段里已经有这个地址时不重复追加：手机上看同一句两遍是噪音。
    expect(formatPushText({ ...CONTENT, body: `原文：${url}` }, url).split(url)).toHaveLength(2)
    // 没有外链就什么都不加，也不写「无链接」那种占位。
    expect(formatPushText(CONTENT)).toBe('日报已生成\n\n10 月 31 日的情报日报已经生成。\n\n日报生成完成')
  })

  it('takes the link from the record actions, and appends nothing for a deeplink-only event', async () => {
    const { push, requests } = harness({})
    const withLink = {
      ...RECORD,
      actions: [{
        id: 'read-original',
        labelKey: 'notification.action.open-original' as const,
        kind: 'open-external' as const,
        url: 'https://example.com/news/42'
      }]
    }
    await push(withLink, CONTENT)
    // 链接是最后一块：手机上那是唯一能点的东西。
    expect(requests[0]?.text.trimEnd().endsWith('\n\nhttps://example.com/news/42')).toBe(true)

    const deeplinkOnly = {
      ...RECORD,
      id: 'notification-1793875279822-3',
      deeplink: { scope: 'platform' as const },
      actions: [{ id: 'open', labelKey: 'notification.taskFailed.open' as const, kind: 'open' as const, deeplink: { scope: 'platform' as const } }]
    }
    await push(deeplinkOnly, CONTENT)
    // `deeplink` 是应用内落点，手机上点不动：推送里不许因此出现任何链接。
    expect(requests[1]?.text).not.toContain('http')
  })

  it('sends the first of two external links and leaves a trace, instead of silently picking one', async () => {
    const events: { code: string; detail: { recordId: string; count: number } }[] = []
    const { push, requests } = harness({ diagnostics: (code, detail) => { events.push({ code, detail }) } })
    const twoLinks = {
      ...RECORD,
      actions: [
        { id: 'a', labelKey: 'notification.action.open-original' as const, kind: 'open-external' as const, url: 'https://example.com/first' },
        { id: 'b', labelKey: 'notification.action.open-original' as const, kind: 'open-external' as const, url: 'https://example.com/second' }
      ]
    }
    await push(twoLinks, CONTENT)

    expect(requests[0]?.text.trimEnd().endsWith('https://example.com/first')).toBe(true)
    expect(requests[0]?.text).not.toContain('https://example.com/second')
    // 取第一个不等于「悄悄取第一个」：多出来的那一条要留痕。
    expect(events).toEqual([{ code: 'multiple-external-actions', detail: { recordId: RECORD.id, count: 2 } }])
  })

  it('stays quiet when there is exactly one external link', async () => {
    const events: unknown[] = []
    const { push } = harness({ diagnostics: () => { events.push(1) } })
    await push({ ...RECORD, actions: [{ id: 'a', labelKey: 'notification.action.open-original' as const, kind: 'open-external' as const, url: 'https://example.com/only' }] }, CONTENT)
    expect(events).toEqual([])
  })

  it('treats a delivered result without an attempt id as accepted without evidence id', () => {
    expect(mapChannelDeliveryResult({ status: 'delivered', attemptId: null, errorCode: null })).toEqual({ ok: true })
  })
})
