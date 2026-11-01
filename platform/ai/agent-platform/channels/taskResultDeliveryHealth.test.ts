import { describe, expect, it } from 'vitest'

import {
  aggregateTaskResultDeliveryHealth,
  emptyTaskResultDeliveryCounts,
  type TaskResultDeliveryAttemptRow
} from './taskResultDeliveryHealth'

function row(overrides: Partial<TaskResultDeliveryAttemptRow> = {}): TaskResultDeliveryAttemptRow {
  return {
    channelId: 'channel-1',
    sourceId: 'run-1:completed',
    status: 'delivered',
    errorCode: null,
    attemptCount: 1,
    completedAt: '2026-11-01T00:00:00.000Z',
    ...overrides
  }
}

describe('task result delivery health', () => {
  it('counts all six states separately, keeping a message in flight out of the queue', () => {
    const result = aggregateTaskResultDeliveryHealth({
      rows: [
        row({ channelId: 'a', status: 'pending' }),
        row({ channelId: 'b', status: 'sending' }),
        row({ channelId: 'c', status: 'delivered' }),
        row({ channelId: 'd', status: 'failed' }),
        row({ channelId: 'e', status: 'unknown-after-send' }),
        row({ channelId: 'f', status: 'skipped' })
      ],
      taskIdByRunLogId: new Map([['run-1', 'task-1']]),
      subscribedChannelIdsByTaskId: new Map([['task-1', ['a', 'b', 'c', 'd', 'e', 'f']]])
    })

    expect(result.byTask['task-1'].counts).toEqual({
      pending: 1,
      sending: 1,
      delivered: 1,
      failed: 1,
      unknown: 1,
      skipped: 1
    })
  })

  it('groups by task and keeps every channel as its own row', () => {
    const result = aggregateTaskResultDeliveryHealth({
      rows: [
        row({ channelId: 'a', sourceId: 'run-1:completed', status: 'delivered' }),
        row({ channelId: 'b', sourceId: 'run-1:completed', status: 'failed', attemptCount: 3 }),
        row({ channelId: 'a', sourceId: 'run-2:failed', status: 'delivered' })
      ],
      taskIdByRunLogId: new Map([['run-1', 'task-1'], ['run-2', 'task-2']]),
      subscribedChannelIdsByTaskId: new Map([
        ['task-1', ['a', 'b']],
        ['task-2', ['a']]
      ])
    })

    expect(Object.keys(result.byTask).sort()).toEqual(['task-1', 'task-2'])
    expect(result.byTask['task-1'].channels.map((channel) => [channel.channelId, channel.status, channel.attemptCount]))
      .toEqual([['a', 'delivered', 1], ['b', 'failed', 3]])
    expect(result.byTask['task-1'].counts.delivered).toBe(1)
    expect(result.byTask['task-1'].counts.failed).toBe(1)
    expect(result.byTask['task-2'].counts).toEqual({ ...emptyTaskResultDeliveryCounts(), delivered: 1 })
  })

  it('reports no-channel instead of not-yet when the task binds nothing', () => {
    const result = aggregateTaskResultDeliveryHealth({
      rows: [],
      taskIdByRunLogId: new Map([['run-1', 'task-1']]),
      subscribedChannelIdsByTaskId: new Map([['task-1', []]])
    })

    expect(result.byTask['task-1']).toEqual({
      state: 'no-channel',
      counts: emptyTaskResultDeliveryCounts(),
      channels: []
    })
  })

  it('reports not-yet when the task binds a channel but this run produced no delivery row', () => {
    const result = aggregateTaskResultDeliveryHealth({
      rows: [],
      taskIdByRunLogId: new Map([['run-1', 'task-1']]),
      subscribedChannelIdsByTaskId: new Map([['task-1', ['a']]])
    })

    expect(result.byTask['task-1'].state).toBe('not-yet')
  })

  it('counts an unreadable source id instead of dropping it silently', () => {
    const result = aggregateTaskResultDeliveryHealth({
      rows: [row({ sourceId: 'not-a-task-result-source' })],
      taskIdByRunLogId: new Map([['run-1', 'task-1']]),
      subscribedChannelIdsByTaskId: new Map([['task-1', ['a']]])
    })

    expect(result.unreadableRows).toBe(1)
    expect(result.byTask['task-1'].state).toBe('not-yet')
  })

  it('counts a row whose run names no known task instead of attributing it to a guess', () => {
    const result = aggregateTaskResultDeliveryHealth({
      rows: [row({ sourceId: 'run-unknown:completed' })],
      taskIdByRunLogId: new Map([['run-1', 'task-1']]),
      subscribedChannelIdsByTaskId: new Map([['task-1', ['a']]])
    })

    expect(result.unmappedRows).toBe(1)
    expect(result.byTask['task-1'].counts).toEqual(emptyTaskResultDeliveryCounts())
  })

  it('keeps the skip reason on the channel row so the UI can explain it', () => {
    const result = aggregateTaskResultDeliveryHealth({
      rows: [row({ status: 'skipped', errorCode: 'delivery-target-disabled' })],
      taskIdByRunLogId: new Map([['run-1', 'task-1']]),
      subscribedChannelIdsByTaskId: new Map([['task-1', ['a']]])
    })

    expect(result.byTask['task-1'].channels[0].errorCode).toBe('delivery-target-disabled')
  })

  it('ignores the run outcome in the source id, since the delivery row owns the status', () => {
    const result = aggregateTaskResultDeliveryHealth({
      rows: [row({ sourceId: 'run-1:cancelled', status: 'skipped' })],
      taskIdByRunLogId: new Map([['run-1', 'task-1']]),
      subscribedChannelIdsByTaskId: new Map([['task-1', ['a']]])
    })

    expect(result.byTask['task-1'].counts.skipped).toBe(1)
    expect(result.byTask['task-1'].counts.failed).toBe(0)
  })

  it('takes a runLogId that itself contains a colon', () => {
    const result = aggregateTaskResultDeliveryHealth({
      rows: [row({ sourceId: 'task:run:1:completed' })],
      taskIdByRunLogId: new Map([['task:run:1', 'task-1']]),
      subscribedChannelIdsByTaskId: new Map([['task-1', ['a']]])
    })

    expect(result.byTask['task-1'].counts.delivered).toBe(1)
    expect(result.unreadableRows).toBe(0)
  })
})
