/**
 * 通道链路有两个测试根，只跑一个会「看起来全绿却漏掉消费者」：
 *   platform/ai/agent-platform/channels/   与   platform/desktop/main/taskChannelDelivery.test.ts
 * 本文件是 sourceId 格式与跳过码的消费方，不在 channels 目录内。改这条链路时两个必须一起跑：
 *   pnpm exec vitest run platform/ai/agent-platform/channels platform/desktop/main/taskChannelDelivery.test.ts
 */
import { describe, expect, it, vi } from 'vitest'

import { createTaskChannelDelivery } from './taskChannelDelivery'

describe('task channel delivery', () => {
  it('delegates task results to the unified delivery kernel without legacy active chats', async () => {
    const deliverToEnabledTargets = vi.fn(async () => [
      { status: 'delivered' as const, attemptId: 'attempt-1', errorCode: null },
      { status: 'skipped' as const, attemptId: null, errorCode: 'delivery-no-target-bound' }
    ])
    const patchDeliverySummary = vi.fn(async () => {})
    const delivery = createTaskChannelDelivery({
      delivery: { deliverToEnabledTargets } as never,
      patchDeliverySummary
    })

    await delivery.deliver({
      taskId: 'task-1', taskNameSnapshot: 'Task', sourceTaskId: null, agentId: 'agent-1', sessionId: 'session-1',
      runLogId: 'run-1', channelIds: ['channel-1', 'channel-1'], status: 'completed', text: 'result', error: null
    })

    expect(deliverToEnabledTargets).toHaveBeenCalledOnce()
    expect(deliverToEnabledTargets).toHaveBeenCalledWith(expect.objectContaining({
      channelId: 'channel-1', agentId: 'agent-1', source: 'task-result', sourceId: 'run-1:completed'
    }))
    expect(patchDeliverySummary).toHaveBeenCalledWith('run-1', { delivered: 1, failed: 0, skipped: 1, unknown: 0 })
  })

  it('keeps the legacy retry summary shape without a legacy target read path', async () => {
    const delivery = createTaskChannelDelivery({ delivery: {} as never, patchDeliverySummary: async () => {} })
    await expect(delivery.retry('agent-1', 'run-1', 'attempt-1')).resolves.toEqual({ delivered: 0, failed: 0, skipped: 0, unknown: 0 })
  })
})
