import { describe, expect, it, vi } from 'vitest'

import { createJobRuntime } from '../../jobs'
import { createAgentTaskJobBridge } from './agentTaskJobBridge'

describe('agentTaskJobBridge', () => {
  it('creates a platform job run and records task output on completion', async () => {
    const jobRuntime = createJobRuntime()
    const bridge = createAgentTaskJobBridge({ jobRuntime })

    const started = await bridge.startTaskRun({
      taskId: 'task-1',
      sourceTaskId: 'task-1',
      agentId: 'agent-1',
      taskName: 'Scheduled Review',
      runLogId: 'task-run-1',
      timeoutMinutes: 2,
      payload: {
        agentId: 'agent-1',
        prompt: 'Run the scheduled review.',
        timeoutMinutes: 2,
        workspace: { type: 'user', workspaceId: 'workspace-1' }
      }
    })

    await bridge.completeTaskRun({
      jobRunId: started.jobRunId,
      taskId: 'task-1',
      runLogId: 'task-run-1',
      sessionId: 'session-1',
      output: 'Assistant preview'
    })

    await vi.waitFor(() => {
      expect(jobRuntime.getRun(started.jobRunId)?.status).toBe('completed')
    })
    const run = jobRuntime.getRun(started.jobRunId)
    expect(run).toMatchObject({
      owner: 'platform',
      handlerId: 'platform.agent.task.run',
      title: 'Agent task: Scheduled Review',
      progress: {
        current: 1,
        total: 1,
        message: 'Assistant preview'
      }
    })
    expect(run?.logs).toEqual([
      expect.objectContaining({
        level: 'info',
        message: 'Agent task completed.',
        metadata: expect.objectContaining({
          taskId: 'task-1',
          runLogId: 'task-run-1',
          sessionId: 'session-1',
          output: 'Assistant preview'
        })
      })
    ])
  })

  it('exposes the job timeout abort signal to task dispatch', async () => {
    vi.useFakeTimers()
    try {
      const jobRuntime = createJobRuntime()
      const bridge = createAgentTaskJobBridge({ jobRuntime })
      const started = await bridge.startTaskRun({
        taskId: 'task-1',
        sourceTaskId: 'task-1',
        agentId: 'agent-1',
        taskName: 'Scheduled Review',
        runLogId: 'task-run-1',
        timeoutMinutes: 1 / 60_000,
        payload: {
          agentId: 'agent-1',
          prompt: 'Run the scheduled review.',
          timeoutMinutes: 1 / 60_000,
          workspace: { type: 'user', workspaceId: 'workspace-1' }
        }
      })

      expect(started.signal?.aborted).toBe(false)
      await vi.advanceTimersByTimeAsync(1)

      expect(started.signal?.aborted).toBe(true)
      await vi.waitFor(() => {
        expect(jobRuntime.getRun(started.jobRunId)).toMatchObject({
          status: 'failed',
          lastError: 'Job timed out after 1ms.'
        })
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('stores task identifiers as queryable platform job payload metadata', async () => {
    const jobRuntime = createJobRuntime()
    const bridge = createAgentTaskJobBridge({ jobRuntime })

    const started = await bridge.startTaskRun({
      taskId: 'task-1',
      sourceTaskId: 'source-task-1',
      agentId: 'agent-1',
      taskName: 'Scheduled Review',
      runLogId: 'task-run-1',
      timeoutMinutes: 2,
      payload: {
        agentId: 'agent-1',
        prompt: 'Run the scheduled review.',
        timeoutMinutes: 2,
        workspace: { type: 'user', workspaceId: 'workspace-1' }
      }
    })

    const runs = jobRuntime.listRuns({
      owner: 'platform',
      definitionIdPrefix: 'platform.agent.task.',
      payload: {
        taskId: 'task-1',
        sourceTaskId: 'source-task-1',
        runLogId: 'task-run-1',
        agentId: 'agent-1'
      }
    })

    expect(runs.map((run) => run.id)).toEqual([started.jobRunId])
  })

  it('forwards shutdown cancel reasons to the running platform job signal', async () => {
    const jobRuntime = createJobRuntime()
    const bridge = createAgentTaskJobBridge({ jobRuntime })

    const started = await bridge.startTaskRun({
      taskId: 'task-1',
      sourceTaskId: 'task-1',
      agentId: 'agent-1',
      taskName: 'Scheduled Review',
      runLogId: 'task-run-1',
      timeoutMinutes: 2,
      payload: {
        agentId: 'agent-1',
        prompt: 'Run the scheduled review.',
        timeoutMinutes: 2,
        workspace: { type: 'user', workspaceId: 'workspace-1' }
      }
    })

    await bridge.cancelTaskRun({
      jobRunId: started.jobRunId,
      taskId: 'task-1',
      runLogId: 'task-run-1',
      sessionId: 'session-1',
      reason: 'Stopped by runtime shutdown.',
      reasonKind: 'shutdown'
    })

    await vi.waitFor(() => {
      expect(started.signal?.aborted).toBe(true)
      expect(jobRuntime.getRun(started.jobRunId)).toMatchObject({
        status: 'cancelled',
        lastError: 'Stopped by runtime shutdown.'
      })
    })
    expect(started.signal?.reason).toEqual({
      kind: 'shutdown',
      message: 'Stopped by runtime shutdown.'
    })
  })

  it('returns an aborted signal when a queued task job is cancelled before the handler starts', async () => {
    const jobRuntime = createJobRuntime()
    const bridge = createAgentTaskJobBridge({ jobRuntime })

    const firstRun = await bridge.startTaskRun({
      taskId: 'task-1',
      sourceTaskId: 'task-1',
      agentId: 'agent-1',
      taskName: 'Scheduled Review',
      runLogId: 'task-run-1',
      timeoutMinutes: 2,
      payload: {
        agentId: 'agent-1',
        prompt: 'Run the scheduled review.',
        timeoutMinutes: 2,
        workspace: { type: 'user', workspaceId: 'workspace-1' }
      }
    })

    const secondRunPromise = bridge.startTaskRun({
      taskId: 'task-1',
      sourceTaskId: 'task-1',
      agentId: 'agent-1',
      taskName: 'Scheduled Review',
      runLogId: 'task-run-2',
      timeoutMinutes: 2,
      payload: {
        agentId: 'agent-1',
        prompt: 'Run the scheduled review.',
        timeoutMinutes: 2,
        workspace: { type: 'user', workspaceId: 'workspace-1' }
      }
    })

    const queuedRun = await vi.waitFor(() => {
      const run = jobRuntime.listRuns({
        owner: 'platform',
        handlerId: 'platform.agent.task.run',
        payload: { runLogId: 'task-run-2' }
      })[0]
      expect(run?.status).toBe('queued')
      return run
    })

    jobRuntime.cancel(queuedRun.id, {
      kind: 'cancelled',
      message: 'Cancelled by user.'
    })

    let startedSecondRun: Awaited<ReturnType<typeof bridge.startTaskRun>> | null = null
    void Promise.resolve(secondRunPromise).then((value: Awaited<ReturnType<typeof bridge.startTaskRun>>) => {
      startedSecondRun = value
    })

    await vi.waitFor(() => {
      expect(startedSecondRun?.jobRunId).toBe(queuedRun.id)
      expect(startedSecondRun?.signal?.aborted).toBe(true)
      expect(startedSecondRun?.signal?.reason).toEqual({
        kind: 'cancelled',
        message: 'Cancelled by user.'
      })
    })

    await bridge.completeTaskRun({
      jobRunId: firstRun.jobRunId,
      taskId: 'task-1',
      runLogId: 'task-run-1',
      sessionId: 'session-1',
      output: 'done'
    })
  })

  it('returns a timeout-aborted signal when a queued task job times out before the handler starts', async () => {
    vi.useFakeTimers()
    try {
      const jobRuntime = createJobRuntime()
      const bridge = createAgentTaskJobBridge({ jobRuntime })

      const firstRun = await bridge.startTaskRun({
        taskId: 'task-1',
        sourceTaskId: 'task-1',
        agentId: 'agent-1',
        taskName: 'Scheduled Review',
        runLogId: 'task-run-1',
        timeoutMinutes: 2,
        payload: {
          agentId: 'agent-1',
          prompt: 'Run the scheduled review.',
          timeoutMinutes: 2,
          workspace: { type: 'user', workspaceId: 'workspace-1' }
        }
      })

      const secondRunPromise = bridge.startTaskRun({
        taskId: 'task-1',
        sourceTaskId: 'task-1',
        agentId: 'agent-1',
        taskName: 'Scheduled Review',
        runLogId: 'task-run-2',
        timeoutMinutes: 100 / 60_000,
        payload: {
          agentId: 'agent-1',
          prompt: 'Run the scheduled review.',
          timeoutMinutes: 100 / 60_000,
          workspace: { type: 'user', workspaceId: 'workspace-1' }
        }
      })

      await vi.waitFor(() => {
        expect(
          jobRuntime.listRuns({
            owner: 'platform',
            handlerId: 'platform.agent.task.run',
            payload: { runLogId: 'task-run-2' }
          })[0]?.status
        ).toBe('queued')
      })

      await vi.advanceTimersByTimeAsync(100)

      let startedSecondRun: Awaited<ReturnType<typeof bridge.startTaskRun>> | null = null
      void Promise.resolve(secondRunPromise).then((value: Awaited<ReturnType<typeof bridge.startTaskRun>>) => {
        startedSecondRun = value
      })

      await vi.waitFor(() => {
        expect(startedSecondRun?.signal?.aborted).toBe(true)
        expect(startedSecondRun?.signal?.reason).toEqual({
          kind: 'timeout',
          message: 'Job timed out after 100ms.'
        })
      })

      await bridge.completeTaskRun({
        jobRunId: firstRun.jobRunId,
        taskId: 'task-1',
        runLogId: 'task-run-1',
        sessionId: 'session-1',
        output: 'done'
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns a shutdown-aborted signal when a queued task job is stopped before the handler starts', async () => {
    const jobRuntime = createJobRuntime()
    const bridge = createAgentTaskJobBridge({ jobRuntime })

    const firstRun = await bridge.startTaskRun({
      taskId: 'task-1',
      sourceTaskId: 'task-1',
      agentId: 'agent-1',
      taskName: 'Scheduled Review',
      runLogId: 'task-run-1',
      timeoutMinutes: 2,
      payload: {
        agentId: 'agent-1',
        prompt: 'Run the scheduled review.',
        timeoutMinutes: 2,
        workspace: { type: 'user', workspaceId: 'workspace-1' }
      }
    })

    const secondRunPromise = bridge.startTaskRun({
      taskId: 'task-1',
      sourceTaskId: 'task-1',
      agentId: 'agent-1',
      taskName: 'Scheduled Review',
      runLogId: 'task-run-2',
      timeoutMinutes: 2,
      payload: {
        agentId: 'agent-1',
        prompt: 'Run the scheduled review.',
        timeoutMinutes: 2,
        workspace: { type: 'user', workspaceId: 'workspace-1' }
      }
    })

    await vi.waitFor(() => {
      expect(
        jobRuntime.listRuns({
          owner: 'platform',
          handlerId: 'platform.agent.task.run',
          payload: { runLogId: 'task-run-2' }
        })[0]?.status
      ).toBe('queued')
    })

    jobRuntime.stopAll()

    let startedSecondRun: Awaited<ReturnType<typeof bridge.startTaskRun>> | null = null
    void Promise.resolve(secondRunPromise).then((value: Awaited<ReturnType<typeof bridge.startTaskRun>>) => {
      startedSecondRun = value
    })

    await vi.waitFor(() => {
      expect(startedSecondRun?.jobRunId).toBeTruthy()
      expect(startedSecondRun?.signal?.aborted).toBe(true)
      expect(startedSecondRun?.signal?.reason).toEqual({
        kind: 'shutdown',
        message: 'Stopped by runtime shutdown.'
      })
      expect(jobRuntime.getRun(firstRun.jobRunId)?.status).toBe('cancelled')
    })
  })
})
