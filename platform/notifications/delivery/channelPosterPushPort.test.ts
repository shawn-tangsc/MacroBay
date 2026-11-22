import { describe, expect, it, vi } from 'vitest'

import {
  CHANNEL_POSTER_RETRY_WAIT_CAP_MS,
  createChannelPosterPushPort,
  type ChannelPosterPushPortDeps
} from './channelPosterPushPort'
import type {
  ChannelConversationSafeView,
  ChannelDeliveryTargetView,
  ChannelManagementSafeView
} from '../../ai/agent-platform/channels/ChannelManagementContracts'
import type { ChannelDeliveryResult } from '../../ai/agent-platform/channels/ChannelDeliveryContracts'
import type { NotificationRecord } from '../contracts/notificationContracts'

/**
 * 简报海报的推送端口（方案 §12.4）：图无 caption、幂等键带内容版本、429 只按上游的话等一次。
 *
 * 这里守的都是**会静默出错的**那几条：caption 一多就变成「图 + 导读」两条消息；
 * 键不带版本，重生成后的新海报永远发不出去；没有 retry_after 却自己编个退避，等于连撞两次 429。
 */
const HASH = 'a1b2c3d4e5f60718'

const RECORD = {
  id: 'notification-1793875279820-1',
  owner: 'product',
  productId: 'market-intelligence',
  sourceId: 'market-intelligence.daily-briefing.ready',
  eventTypeId: 'market-intelligence.daily-briefing.ready',
  delivery: {},
  severity: 'info',
  priority: 'normal',
  channels: ['center'],
  state: 'unread',
  actions: [],
  occurrenceCount: 1,
  edition: { editionId: '2026-11-22:zh-CN:default', locale: 'zh-CN' },
  editionPoster: { contentHash: HASH },
  createdAt: '2026-11-22T00:30:00.000Z',
  updatedAt: '2026-11-22T00:30:00.000Z'
} satisfies NotificationRecord

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

function conversation(): ChannelConversationSafeView {
  return { id: 'conversation-1', kind: 'direct', hasBoundSession: true, targetEnabled: true, sessionTitle: null, createdAt: '2026-11-01T00:00:00.000Z' }
}

const PNG = (() => {
  const value = new Uint8Array(64)
  value.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return value
})()

const TARGETS = [{ channelId: 'channel-a', channelName: 'Telegram' }] as const

function harness(options: {
  poster?: ChannelPosterPushPortDeps['resolvePoster']
  results?: readonly ChannelDeliveryResult[]
  target?: ChannelDeliveryTargetView | undefined
} = {}) {
  const deliverImage = vi.fn()
  const queue = [...(options.results ?? [{ status: 'delivered' as const, attemptId: 'attempt-1', errorCode: null }])]
  deliverImage.mockImplementation(async () => queue.length > 1 ? queue.shift() : (queue[0] ?? { status: 'delivered', attemptId: 'attempt-1', errorCode: null }))
  const waits: number[] = []
  const port = createChannelPosterPushPort({
    channels: {
      list: () => [channel()],
      listDeliveryTargets: () => ({ channels: options.target === undefined ? [targetView()] : [options.target] }),
      listConversations: () => [conversation()]
    },
    resolvePoster: options.poster ?? (async () => ({ ok: true, mime: 'image/png', bytes: PNG })),
    deliverImage: (request) => deliverImage(request),
    wait: async (ms) => { waits.push(ms) }
  })
  return { port, deliverImage, waits, push: (record: NotificationRecord = RECORD) => port(record, TARGETS) }
}

describe('channelPosterPushPort', () => {
  it('sends the poster with no caption and a key that carries the content version', async () => {
    const { push, deliverImage } = harness()
    const attempts = await push()

    expect(attempts).toEqual([{ channelId: 'channel-a', channelName: 'Telegram', result: { ok: true, messageId: 'attempt-1' } }])
    expect(deliverImage).toHaveBeenCalledTimes(1)
    expect(deliverImage.mock.calls[0][0]).toMatchObject({
      channelId: 'channel-a',
      agentId: 'agent-a',
      source: 'notification',
      // 正文那一条已经把话说完了：图**不带 caption**（否则读者收到同一段话两遍）。
      caption: '',
      // 带内容版本：同一张图重投是同一键（幂等），换一张图就是新键（新尝试）。
      sourceId: `notification-1793875279820-1:image:${HASH}`
    })
  })

  it('reads the poster once for N channels', async () => {
    const resolvePoster = vi.fn(async () => ({ ok: true as const, mime: 'image/png', bytes: PNG }))
    const port = createChannelPosterPushPort({
      channels: {
        list: () => [channel()],
        listDeliveryTargets: () => ({ channels: [targetView()] }),
        listConversations: () => [conversation()]
      },
      resolvePoster,
      deliverImage: async () => ({ status: 'delivered', attemptId: 'attempt-1', errorCode: null }),
      wait: async () => undefined
    })
    await port(RECORD, [{ channelId: 'channel-a', channelName: 'Telegram' }, { channelId: 'channel-a', channelName: 'Telegram' }])
    expect(resolvePoster).toHaveBeenCalledTimes(1)
  })

  it('waits exactly what the upstream asked and retries once on a rate limit', async () => {
    const { push, deliverImage, waits } = harness({
      results: [
        { status: 'failed', attemptId: 'attempt-1', errorCode: 'delivery-rate-limited', retryAfterMs: 2_000 },
        { status: 'delivered', attemptId: 'attempt-2', errorCode: null }
      ]
    })
    const attempts = await push()

    expect(waits).toEqual([2_000])
    expect(deliverImage).toHaveBeenCalledTimes(2)
    expect(attempts[0]?.result).toEqual({ ok: true, messageId: 'attempt-2' })
  })

  it('does not invent a backoff when the upstream gave no retry_after', async () => {
    const { push, deliverImage, waits } = harness({
      results: [{ status: 'failed', attemptId: 'attempt-1', errorCode: 'delivery-rate-limited' }]
    })
    const attempts = await push()
    // 自己编一个数字，只会在上游还限流时换来第二次 429，然后被记成「通道坏了」。
    expect(waits).toEqual([])
    expect(deliverImage).toHaveBeenCalledTimes(1)
    expect(attempts[0]?.result).toEqual({ ok: false, reason: 'delivery-rate-limited' })
  })

  it('does not wait beyond the cap: a long retry_after is recorded as a failure', async () => {
    const { push, deliverImage, waits } = harness({
      results: [{ status: 'failed', attemptId: 'attempt-1', errorCode: 'delivery-rate-limited', retryAfterMs: CHANNEL_POSTER_RETRY_WAIT_CAP_MS + 1 }]
    })
    await push()
    expect(waits).toEqual([])
    expect(deliverImage).toHaveBeenCalledTimes(1)
  })

  it('keeps the image error code on the row instead of flattening it to "channel rejected"', async () => {
    const { push } = harness({ results: [{ status: 'failed', attemptId: 'attempt-1', errorCode: 'delivery-image-unsupported' }] })
    const attempts = await push()
    // 审计要看得出是哪一类没发出去（格式不认 / 太大 / 图不在）。
    expect(attempts[0]?.result).toEqual({ ok: false, reason: 'delivery-image-unsupported' })
  })

  it('sends nothing and reports the source code when this edition has no poster', async () => {
    const { push, deliverImage } = harness({ poster: async () => ({ ok: false, code: 'delivery-image-source-not-allowed', detail: 'poster-not-found' }) })
    const attempts = await push()
    expect(deliverImage).not.toHaveBeenCalled()
    expect(attempts[0]?.result).toEqual({ ok: false, reason: 'delivery-image-source-not-allowed' })
  })

  it('reports "cannot read" differently from "no poster"', async () => {
    const { push, deliverImage } = harness({ poster: async () => ({ ok: false, code: 'delivery-image-unavailable', detail: 'read-failed' }) })
    const attempts = await push()
    expect(deliverImage).not.toHaveBeenCalled()
    expect(attempts[0]?.result).toEqual({ ok: false, reason: 'delivery-image-unavailable' })
  })

  it('returns nothing at all when the record carries no poster', async () => {
    const { push, deliverImage } = harness()
    const attempts = await push({ ...RECORD, editionPoster: undefined })
    expect(attempts).toEqual([])
    expect(deliverImage).not.toHaveBeenCalled()
  })

  it('fails only its own channel when the target is missing (a bad channel does not stop the rest)', async () => {
    const { push, deliverImage } = harness({ target: targetView({ deliverable: false, reason: 'no-enabled-target' }) })
    const attempts = await push()
    expect(attempts[0]?.result).toEqual({ ok: false, reason: 'delivery-no-target-bound' })
    expect(deliverImage).not.toHaveBeenCalled()
  })
})