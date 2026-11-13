import { describe, expect, it } from 'vitest'

import type { NotificationRecord, PushChannelOutcome } from '../contracts/notificationContracts'
import { readPosterChannels, recordPosterOutcomes } from './notificationPosterRecord'

/**
 * 海报那一路的逐通道结果写回**同一条**通知记录（海报方案 §5）：
 * `kind` 必须原样留着——读者/排障要能一眼看出这条通道走的是图还是纯文字降级。
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
    delivery: { push: { state: 'queued', at: AT, pushCount: 1, highestSeverity: 'high' as never } },
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

describe('recording poster outcomes on the same record', () => {
  it('keeps each row with its kind, and aggregates once (image + text degradation visible)', async () => {
    const h = harness(record())
    const result = await recordPosterOutcomes({
      ...h.deps,
      recordId: 'record-1',
      channels: [outcome('channel-a', 'image', 'sent-accepted'), outcome('channel-b', 'text', 'failed', 'channel-rejected')]
    })

    expect(result).toMatchObject({ ok: true })
    const push = h.persisted().delivery.push!
    // 一行一条尝试，`kind` 说清哪条是图、哪条是纯文字降级。
    expect(push.channels?.map((entry) => [entry.channelId, entry.kind, entry.state])).toEqual([
      ['channel-a', 'image', 'sent-accepted'],
      ['channel-b', 'text', 'failed']
    ])
    // 同一套聚合：一成一败 → failed，且**不写**总括原因（逐条原因在 channels 里）。
    expect(push.state).toBe('failed')
    expect(push.reason).toBeUndefined()
    // 只有真写回时才加一次计数，严重度原样保留。
    expect(push.pushCount).toBe(2)
    expect(push.highestSeverity).toBe('high')
    expect(h.notified()).toBe(1)
    expect(h.writes()).toHaveLength(1)
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

  it('leaves previous rows readable when reading them back for a re-send', async () => {
    const h = harness(record())
    await recordPosterOutcomes({
      ...h.deps,
      recordId: 'record-1',
      channels: [outcome('channel-a', 'image', 'sent-accepted'), outcome('channel-b', 'text', 'failed', 'channel-rejected')]
    })
    await expect(readPosterChannels({ recordId: 'record-1', load: h.deps.load }))
      .resolves.toEqual(h.persisted().delivery.push?.channels)
  })
})
