import { describe, expect, it, vi } from 'vitest'

import type { JobRunQueryService, JobRunRecord } from '../../jobs'
import { createJobScheduleQueryService, type JobScheduleQueryService } from '../../jobs/runtime/jobScheduleQueryService'
import { IpcChannels } from '../ipc/channels'
import { registerJobIpcHandlers } from './jobIpcHandlers'

describe('jobIpcHandlers', () => {
  it('registers read-only job run detail and page handlers', async () => {
    const handles = registerHandles()
    const jobs: JobRunQueryService = {
      getRun: vi.fn(async (runId) => ({
        id: runId,
        definitionId: 'platform.agent.task.task-1',
        handlerId: 'agent-task',
        owner: 'platform',
        title: 'Agent task',
        status: 'completed',
        trigger: { kind: 'manual' },
        payload: { taskId: 'task-1' },
        attempt: 1,
        maxAttempts: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        logs: []
      }) satisfies JobRunRecord),
      listRunPage: vi.fn(async (query) => ({
        runs: [],
        nextCursor: query?.cursor ?? null
      }))
    }

    registerJobIpcHandlers(handles.ipcMain, jobs, emptySchedules())

    await expect(handles.get(IpcChannels.jobsGetRun)?.({}, 'run-1')).resolves.toMatchObject({ id: 'run-1' })
    await expect(
      handles.get(IpcChannels.jobsListRunPage)?.({}, { owner: 'platform', limit: 10, cursor: 'run-9' })
    ).resolves.toEqual({ runs: [], nextCursor: 'run-9' })
    expect(jobs.getRun).toHaveBeenCalledWith('run-1')
    expect(jobs.listRunPage).toHaveBeenCalledWith({ owner: 'platform', limit: 10, cursor: 'run-9' })
  })

  it('registers a read-only projection of the registered job schedules', async () => {
    const handles = registerHandles()
    const schedules = createJobScheduleQueryService({
      runtime: {
        listSchedules: () => [{
          id: 'market-intelligence.source.crypto-news',
          owner: 'product',
          productId: 'market-intelligence',
          handlerId: 'intelligence-source',
          title: 'Crypto news collection',
          trigger: { kind: 'interval', intervalMs: 900_000, anchor: 'lastComplete' },
          payload: { credentialRef: 'vault://market-intelligence/news', prompt: 'internal instruction' }
        }],
        listRuns: () => [{
          id: 'run-1',
          definitionId: 'market-intelligence.source.crypto-news',
          handlerId: 'intelligence-source',
          owner: 'product',
          productId: 'market-intelligence',
          title: 'Crypto news collection',
          status: 'completed',
          trigger: { kind: 'manual' },
          payload: {},
          attempt: 1,
          maxAttempts: 1,
          createdAt: '2026-07-17T08:00:00.000Z',
          startedAt: '2026-07-17T08:00:00.000Z',
          completedAt: '2026-07-17T08:00:02.000Z',
          logs: []
        }]
      },
      now: () => new Date('2026-07-17T08:10:00.000Z')
    })

    registerJobIpcHandlers(handles.ipcMain, emptyRunQueries(), schedules)

    expect(handles.has(IpcChannels.jobsListSchedules)).toBe(true)
    const views = await handles.get(IpcChannels.jobsListSchedules)?.({}) as unknown[]
    expect(views).toEqual([{
      id: 'market-intelligence.source.crypto-news',
      title: 'Crypto news collection',
      owner: 'product',
      productId: 'market-intelligence',
      trigger: { kind: 'interval', intervalMs: 900_000, anchor: 'lastComplete' },
      registered: true,
      nextRunAt: '2026-07-17T08:15:02.000Z',
      lastRunAt: '2026-07-17T08:00:02.000Z',
      lastOutcome: 'success',
      lastRunStatus: 'completed',
      lastDurationMs: 2_000,
      lastErrorSummary: null
    }])
    expect(JSON.stringify(views)).not.toContain('vault://')
    expect(JSON.stringify(views)).not.toContain('internal instruction')
  })
})

function registerHandles() {
  const handles = new Map<string, (...args: unknown[]) => unknown>()
  return {
    ipcMain: {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
        handles.set(channel, handler)
      })
    },
    get: (channel: string) => handles.get(channel),
    has: (channel: string) => handles.has(channel)
  }
}

function emptySchedules(): JobScheduleQueryService {
  return { listSchedules: async () => [] }
}

function emptyRunQueries(): JobRunQueryService {
  return {
    getRun: async () => null,
    listRunPage: async () => ({ runs: [], nextCursor: null })
  }
}
