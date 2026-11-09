import { describe, expect, it, vi } from 'vitest'

import type { JobRuntime } from '@platform/jobs'
import { createAgentPlatformDatabase } from '../db/createAgentPlatformDatabase'
import { CHANNEL_RUNTIME_AUDIT_KEEP } from './channelRuntimeAuditRetention'
import { pruneChannelRuntimeAudits } from './channelRuntimeAuditPrune'
import {
  channelRuntimeAuditRetentionJobId,
  registerChannelRuntimeAuditRetentionJob
} from './channelRuntimeAuditRetentionJob'

/**
 * B3：运行审计**按频道**保留最近 500 行，且这件事由一个可复跑的裁剪 + 一个保留期任务承担。
 *
 * 写入时已经裁过当前频道，这里要证明的是另一半：**一次处理所有频道**、删的是最旧的、
 * 连跑两次第二次删 0 条（幂等），并且删了多少能回报出来对账。
 */
function databaseWith(rows: ReadonlyArray<{ channelId: string; code: string; at: string }>) {
  const database = createAgentPlatformDatabase(':memory:')
  const insert = database.connection.prepare(
    'insert into channel_runtime_audits (id, channel_id, generation, code, created_at) values (?, ?, ?, ?, ?)'
  )
  rows.forEach((row, index) => insert.run(`audit-${String(index).padStart(5, '0')}`, row.channelId, 1, row.code, row.at))
  return database
}

const failureRows = (channelId: string, count: number, startMs = 0) => Array.from({ length: count }, (_, index) => ({
  channelId,
  code: 'telegram-poll-failed',
  at: new Date(startMs + index * 1_000).toISOString()
}))

describe('channel runtime audit prune', () => {
  it('keeps exactly the newest 500 per channel, deletes the oldest, and leaves other channels alone', () => {
    const database = databaseWith([
      ...failureRows('channel-a', CHANNEL_RUNTIME_AUDIT_KEEP + 1),
      ...failureRows('channel-b', 3, 10 * 24 * 3_600_000)
    ])

    const result = pruneChannelRuntimeAudits(database)
    expect(result).toEqual({ removedFailureRows: 1, removedLifecycleRows: 0 })

    const perChannel = database.connection.prepare(
      'select channel_id as channelId, count(*) as count from channel_runtime_audits group by channel_id order by channel_id'
    ).all() as Array<{ channelId: string; count: number }>
    expect(perChannel).toEqual([
      { channelId: 'channel-a', count: CHANNEL_RUNTIME_AUDIT_KEEP },
      { channelId: 'channel-b', count: 3 }
    ])
    // 删的是**最旧**那条：保留下来的最早时刻 = 第二条。
    const oldest = database.connection.prepare(
      "select created_at as at from channel_runtime_audits where channel_id = 'channel-a' order by created_at asc, id asc limit 1"
    ).get() as { at: string }
    expect(oldest.at).toBe(new Date(1_000).toISOString())

    // 幂等：再跑一次没有任何行可删。
    expect(pruneChannelRuntimeAudits(database)).toEqual({ removedFailureRows: 0, removedLifecycleRows: 0 })
  })

  it('reports what it removed to the retention job log', async () => {
    const prune = vi.fn(() => ({ removedFailureRows: 12, removedLifecycleRows: 3 }))
    let handler: ((payload: unknown, context: { log: (entry: { level: string; message: string }) => Promise<void> }) => Promise<void>) | undefined
    const jobRuntime = {
      registerHandler: (id: string, next: typeof handler) => {
        expect(id).toBe(channelRuntimeAuditRetentionJobId)
        handler = next
      },
      setSchedule: vi.fn()
    } as unknown as JobRuntime
    registerChannelRuntimeAuditRetentionJob(jobRuntime, { audits: () => ({ prune }), timeZone: () => 'Asia/Shanghai' })

    const log = vi.fn(async () => undefined)
    await handler?.({}, { log })
    expect(prune).toHaveBeenCalledOnce()
    expect(log).toHaveBeenCalledWith({
      level: 'info',
      message: 'Channel runtime audit retention: 12 failure row(s) and 3 lifecycle row(s) removed.'
    })
  })
})
