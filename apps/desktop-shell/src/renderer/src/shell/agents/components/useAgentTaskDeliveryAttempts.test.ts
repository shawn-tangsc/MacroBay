// @vitest-environment happy-dom

import { act, createElement, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { TaskDeliveryAttemptEntity } from '@platform/ai/agent-platform/schemas/taskSchemas'

const api = vi.hoisted(() => ({
  getAttempts: vi.fn(),
  retryAttempt: vi.fn()
}))

vi.mock('../agentTaskDataApi', () => ({
  getTaskDeliveryAttemptsViaApi: api.getAttempts,
  retryTaskDeliveryViaApi: api.retryAttempt
}))

import { shouldApplyDeliveryAttemptResponse, useAgentTaskDeliveryAttempts } from './useAgentTaskDeliveryAttempts'

describe('useAgentTaskDeliveryAttempts', () => {
  afterEach(() => {
    api.getAttempts.mockReset()
    api.retryAttempt.mockReset()
    document.body.replaceChildren()
  })

  it('rejects an older run response after the user selects a different historical run', () => {
    expect(shouldApplyDeliveryAttemptResponse({
      latestRequestId: 4,
      responseRequestId: 3,
      latestRunLogId: 'run-older',
      responseRunLogId: 'run-latest'
    })).toBe(false)
    expect(shouldApplyDeliveryAttemptResponse({
      latestRequestId: 4,
      responseRequestId: 4,
      latestRunLogId: 'run-older',
      responseRunLogId: 'run-older'
    })).toBe(true)
  })

  it('retries and refreshes the selected historical run without addressing its latest sibling', async () => {
    const latestRunLogId = 'run-latest'
    const historicalRunLogId = 'run-history-11'
    const historicalAttempt = attemptFixture({ id: 'attempt-history-11', runLogId: historicalRunLogId, status: 'failed' })
    const refreshedAttempt = attemptFixture({ id: 'attempt-history-12', runLogId: historicalRunLogId, status: 'delivered' })
    api.getAttempts.mockResolvedValueOnce({ attempts: [historicalAttempt], total: 1 })
    api.getAttempts.mockResolvedValueOnce({ attempts: [refreshedAttempt], total: 2 })
    api.retryAttempt.mockResolvedValue({ delivered: 1, failed: 0, skipped: 0, unknown: 0 })

    const capture: { current: ReturnType<typeof useAgentTaskDeliveryAttempts> | null } = { current: null }
    const container = document.createElement('div')
    const root = createRoot(container)
    await act(async () => {
      root.render(createElement(Harness, { agentId: 'agent-1', runLogId: historicalRunLogId, capture }))
    })

    await act(async () => {
      await capture.current!.retry(historicalAttempt.id)
    })

    expect(api.retryAttempt).toHaveBeenCalledOnce()
    expect(api.retryAttempt).toHaveBeenCalledWith(window.platform, 'agent-1', historicalRunLogId, historicalAttempt.id)
    expect(api.getAttempts).toHaveBeenCalledTimes(2)
    expect(api.getAttempts).toHaveBeenNthCalledWith(1, window.platform, 'agent-1', historicalRunLogId, { limit: 20, offset: 0 })
    expect(api.getAttempts).toHaveBeenNthCalledWith(2, window.platform, 'agent-1', historicalRunLogId, { limit: 20, offset: 0 })
    expect(api.getAttempts).not.toHaveBeenCalledWith(window.platform, 'agent-1', latestRunLogId, expect.anything())
    expect(capture.current!.attempts).toEqual([refreshedAttempt])

    await act(async () => root.unmount())
  })
})

function Harness({
  agentId,
  runLogId,
  capture
}: {
  agentId: string
  runLogId: string
  capture: { current: ReturnType<typeof useAgentTaskDeliveryAttempts> | null }
}): null {
  const value = useAgentTaskDeliveryAttempts({ agentId, runLogId })
  useEffect(() => {
    capture.current = value
  }, [capture, value])
  return null
}

function attemptFixture(overrides: Partial<TaskDeliveryAttemptEntity>): TaskDeliveryAttemptEntity {
  return {
    id: 'attempt-1',
    runLogId: 'run-1',
    taskId: 'task-1',
    agentId: 'agent-1',
    taskNameSnapshot: 'Task',
    channelId: 'channel-1',
    targetHash: 'target',
    status: 'failed',
    attemptNumber: 1,
    startedAt: '2026-07-16T10:00:00.000Z',
    ...overrides
  }
}
