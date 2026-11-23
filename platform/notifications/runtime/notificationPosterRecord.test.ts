import { describe, expect, it } from 'vitest'

import type { NotificationRecord, PushChannelOutcome } from '../contracts/notificationContracts'
import { readPosterChannels, recordPosterOutcomes } from './notificationPosterRecord'

/**
 * 海报那一路的逐通道结果写回**同一条**通知记录，但写在**它自己那一格**（`delivery.pushImage`）。
 *
 * 这组用例是 2026-11-23 事故的反向证据：正文推送与海报推送共用 `delivery.push` 时，
 * 正文刚发成功的那几行 `sent-accepted` 会被手动带图当成「图也发过了」，于是每条通道都被跳过、
 * 整条报「被拒」，读者一张图都收不到。
 */
const AT = '2026-11-13T10:00:00.000Z'

const outcome = (channelId: string, kind: 'image' | 'text', state: PushChannelOutcome['state'], reason?: string): PushChannelOutcome => ({
  channelId,
  channelName: channelId.toUpperCase(),
  kind,
  state,
  ...(reason === undefined ? {} : { reason }),
  at: AT
})

function record(patch: Partial<NotificationRecord> = {}): NotificationRecord {
  return {
    id: 'record-1',
    owner: 'platform',
    sourceId: 'briefing-ready',
    eventTypeId: 'market-intelligence.briefing.ready',
    // 正文刚刚推送成功：这就是事故现场那一格。
    delivery: {
      push: {
        state: 'sent-accepted',
        at: AT,
        pushCount: 1,
        highestSeverity: 'high' as never,
        channels: [outcome('channel-a', 'text', 'sent-accepted')]
      }
    },
    severity: 'info',
    priority: 'normal',
    channels: ['center', 'channel'],
    state: 'unread',
    actions: [],
    occurrenceCount: 1,
    createdAt: AT,
    updatedAt: AT,
    ...patch
  } as NotificationRecord
}

function harness(initial: NotificationRecord) {
  let state = { records: [initial] }
  const writes: Array<{ records: readonly NotificationRecord[] }> = []
  let notified = 0
  return {
    deps: {
      recordId: initial.id,
      now: AT,
      load: async () => state,
      persist: async (next: typeof state) => { writes.push(next); state = next },
      notifyChanged: () => { notified += 1 }
    },
    persisted: () => state.records[0]!,
    writes: () => writes,
    notified: () => notified
  }
}

describe('poster outcomes live in their own slot', () => {
  it('keeps each row with its kind, aggregates once, and leaves the body account untouched', async () => {
    const h = harness(record())
    const before = JSON.parse(JSON.stringify(h.persisted().delivery.push))
    const result = await recordPosterOutcomes({
      ...h.deps,
      recordId: 'record-1',
      channels: [outcome('channel-a', 'image', 'sent-accepted'), outcome('channel-b', 'text', 'failed', 'channel-rejected')]
    })

    expect(result).toMatchObject({ ok: true })
    const poster = h.persisted().delivery.pushImage!
    expect(poster.channels?.map((entry) => [entry.channelId, entry.kind, entry.state])).toEqual([
      ['channel-a', 'image', 'sent-accepted'],
      ['channel-b', 'text', 'failed']
    ])
    // 同一套聚合：一成一败 → failed，且**不写**总括原因（逐条原因在 channels 里）。
    expect(poster.state).toBe('failed')
    expect(poster.reason).toBeUndefined()
    // 正文那格**一个字都不许变**：状态、逐通道行、计数、严重度全留原样。
    expect(h.persisted().delivery.push).toEqual(before)
    expect(h.notified()).toBe(1)
    expect(h.writes()).toHaveLength(1)
  })

  it('does not count a poster as a body push (pushCount / highestSeverity belong to the body)', async () => {
    const h = harness(record())
    await recordPosterOutcomes({ ...h.deps, recordId: 'record-1', channels: [outcome('channel-a', 'image', 'sent-accepted')] })
    expect(h.persisted().delivery.push?.pushCount).toBe(1)
    expect(h.persisted().delivery.push?.highestSeverity).toBe('high')
  })

  it('says so instead of inventing a record when the id is unknown', async () => {
    const h = harness(record())
    await expect(recordPosterOutcomes({
      ...h.deps,
      recordId: 'missing',
      channels: [outcome('channel-a', 'image', 'sent-accepted')]
    }))
      .resolves.toEqual({ ok: false })
    expect(h.writes()).toHaveLength(0)
  })

  it('a delivered body does not look like a delivered poster: nothing to skip yet', async () => {
    // 事故判据本身：正文已经 `sent-accepted`，但海报一次都没发过 → 判重必须读到**空**，
    // 手动带图才会照发。读 `delivery.push` 的话这里会读到一行，然后每条通道都被跳过。
    const h = harness(record())
    await expect(readPosterChannels({ recordId: 'record-1', load: h.deps.load })).resolves.toEqual([])
  })

  it('reads back only the poster rows, never the body rows', async () => {
    const h = harness(record())
    await recordPosterOutcomes({
      ...h.deps,
      recordId: 'record-1',
      channels: [outcome('channel-a', 'image', 'sent-accepted'), outcome('channel-b', 'text', 'failed', 'channel-rejected')]
    })
    const rows = await readPosterChannels({ recordId: 'record-1', load: h.deps.load })
    expect(rows).toEqual(h.persisted().delivery.pushImage?.channels)
    // 两行都是海报那一次的尝试（一行图、一行纯文字降级），正文那行不在里面。
    expect(rows.map((row) => row.kind)).toEqual(['image', 'text'])
    expect(rows).toHaveLength(2)
  })
})