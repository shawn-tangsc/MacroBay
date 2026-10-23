// @vitest-environment happy-dom

import { act, createElement, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ScheduledTaskEntity } from '@platform/ai/agent-platform/schemas/taskSchemas'

const api = vi.hoisted(() => ({
  getAttempts: vi.fn(),
  getLogs: vi.fn(),
  getPolicy: vi.fn(),
  listAudits: vi.fn(),
  listTasks: vi.fn(),
  updatePolicy: vi.fn()
}))

vi.mock('../../agents/agentTaskDataApi', () => ({
  getTaskAutomationPolicyViaApi: api.getPolicy,
  getTaskDeliveryAttemptsViaApi: api.getAttempts,
  getTaskLogsViaApi: api.getLogs,
  listTaskMutationAuditsViaApi: api.listAudits,
  listTaskPageViaApi: api.listTasks,
  updateTaskAutomationPolicyViaApi: api.updatePolicy
}))

import { useTaskAutomationSettings } from './useTaskAutomationSettings'

describe('useTaskAutomationSettings', () => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

  afterEach(() => {
    for (const mock of Object.values(api)) mock.mockReset()
    document.body.replaceChildren()
  })

  it('loads the latest run snapshot of every task on the page and aggregates delivery health', async () => {
    const first = task('task-1', 'active')
    const second = task('task-2', 'active')
    api.getPolicy.mockResolvedValue({ preset: 'balanced', policy: policy() })
    api.listTasks.mockResolvedValue({ tasks: [first, second], total: 2 })
    api.listAudits.mockResolvedValue({ audits: [], total: 0 })
    api.getLogs.mockImplementation(async (_platform, _agentId, taskId) => ({
      logs: [{ id: `run-${taskId}`, status: 'completed', startedAt: taskId === 'task-1' ? '2026-07-17T08:00:00.000Z' : '2026-07-17T09:00:00.000Z' }],
      total: 1
    }))
    api.getAttempts.mockImplementation(async (_platform, _agentId, runLogId) => ({
      attempts: runLogId === 'run-task-1'
        ? [{ id: 'a-1', taskId: first.id, status: 'delivered' }, { id: 'a-2', taskId: first.id, status: 'failed' }]
        : [{ id: 'a-3', taskId: second.id, status: 'delivered' }],
      total: 1
    }))

    const capture = await mountHook()

    await vi.waitFor(() => expect(capture.current?.state.aggregateHealth).toEqual({
      delivered: 2, failed: 1, pending: 0, skipped: 0, unknown: 0
    }))
    expect(api.getLogs).toHaveBeenCalledWith(window.platform, first.agentId, first.id, { limit: 1 })
    expect(api.getLogs).toHaveBeenCalledWith(window.platform, second.agentId, second.id, { limit: 1 })
    expect(capture.current!.state.latestRunAt).toBe('2026-07-17T09:00:00.000Z')
    expect(capture.current!.state.rows.map((row) => [row.task.id, row.lastRun?.status ?? null])).toEqual([
      ['task-1', 'completed'],
      ['task-2', 'completed']
    ])
    // 没有展开任何行时，本任务详情保持为空
    expect(capture.current!.expandedTaskId).toBeNull()
    expect(capture.current!.audits).toEqual([])
  })

  it('keeps the expanded task detail and ignores a late response for a previously expanded row', async () => {
    const first = task('task-1', 'active')
    const second = task('task-2', 'active')
    const firstAudits = deferred<{ audits: Array<{ id: string; taskId: string }>; total: number }>()
    const secondAudits = deferred<{ audits: Array<{ id: string; taskId: string }>; total: number }>()
    api.getPolicy.mockResolvedValue({ preset: 'balanced', policy: policy() })
    api.listTasks.mockResolvedValue({ tasks: [first, second], total: 2 })
    api.getLogs.mockResolvedValue({ logs: [], total: 0 })
    api.listAudits.mockImplementation((_platform, query) => query.taskId === first.id
      ? firstAudits.promise
      : secondAudits.promise)

    const capture = await mountHook()
    await vi.waitFor(() => expect(capture.current?.loading).toBe(false))
    await act(async () => {
      capture.current!.toggleTaskExpanded(first.id)
    })
    await act(async () => {
      capture.current!.toggleTaskExpanded(second.id)
    })
    expect(capture.current!.audits).toEqual([])

    firstAudits.resolve({ audits: [{ id: 'audit-first', taskId: first.id }], total: 1 })
    secondAudits.resolve({ audits: [{ id: 'audit-second', taskId: second.id }], total: 1 })

    await vi.waitFor(() => expect(capture.current?.audits).toEqual([{ id: 'audit-second', taskId: second.id }]))
    expect(api.listAudits).toHaveBeenCalledWith(window.platform, { taskId: second.id, limit: 5, offset: 0 })
    expect(capture.current!.state.expandedTaskId).toBe(second.id)
  })

  it('collapses the expanded row and clears its audit list', async () => {
    const only = task('task-1', 'active')
    api.getPolicy.mockResolvedValue({ preset: 'balanced', policy: policy() })
    api.listTasks.mockResolvedValue({ tasks: [only], total: 1 })
    api.getLogs.mockResolvedValue({ logs: [], total: 0 })
    api.listAudits.mockResolvedValue({ audits: [{ id: 'audit-1', taskId: only.id }], total: 1 })

    const capture = await mountHook()
    await vi.waitFor(() => expect(capture.current?.loading).toBe(false))
    await act(async () => {
      capture.current!.toggleTaskExpanded(only.id)
    })
    await vi.waitFor(() => expect(capture.current?.audits).toHaveLength(1))

    await act(async () => {
      capture.current!.toggleTaskExpanded(only.id)
    })
    expect(capture.current!.state.expandedTaskId).toBeNull()
    expect(capture.current!.audits).toEqual([])
  })

  it('requests each status page from the server and appends a cursor page', async () => {
    const firstPage = Array.from({ length: 50 }, (_, index) => task(`task-${index + 1}`, 'active'))
    const nextTask = task('task-51', 'active')
    api.getPolicy.mockResolvedValue({ preset: 'balanced', policy: policy() })
    api.getLogs.mockResolvedValue({ logs: [], total: 0 })
    api.listAudits.mockResolvedValue({ audits: [], total: 0 })
    api.listTasks.mockImplementation(async (_platform, query) => query.cursor
      ? { tasks: [nextTask], total: 51 }
      : { tasks: firstPage, total: 51, nextCursor: 'cursor-50' })

    const capture = await mountHook()
    await act(async () => {
      capture.current!.setStatus('active')
    })
    await vi.waitFor(() => expect(capture.current?.state.filteredTasks).toHaveLength(50))
    await act(async () => {
      await capture.current!.loadMore()
    })

    expect(api.listTasks).toHaveBeenCalledWith(window.platform, { status: 'active', limit: 50 })
    expect(api.listTasks).toHaveBeenCalledWith(window.platform, { status: 'active', cursor: 'cursor-50', limit: 50 })
    expect(capture.current!.state.filteredTasks).toHaveLength(51)
  })

  it('ignores a late cursor page after switching to another status filter', async () => {
    const active = task('task-active', 'active')
    const paused = task('task-paused', 'paused')
    const activeMore = deferred<{ tasks: ScheduledTaskEntity[]; total: number; nextCursor?: string }>()
    const pausedPage = deferred<{ tasks: ScheduledTaskEntity[]; total: number; nextCursor?: string }>()
    api.getPolicy.mockResolvedValue({ preset: 'balanced', policy: policy() })
    api.getLogs.mockResolvedValue({ logs: [], total: 0 })
    api.listAudits.mockResolvedValue({ audits: [], total: 0 })
    api.listTasks.mockImplementation((_platform, query) => {
      if (query.status === 'active' && query.cursor === 'active-cursor') return activeMore.promise
      if (query.status === 'active') return Promise.resolve({ tasks: [active], total: 2, nextCursor: 'active-cursor' })
      if (query.status === 'paused') return pausedPage.promise
      return Promise.resolve({ tasks: [], total: 0 })
    })

    const capture = await mountHook()
    await act(async () => {
      capture.current!.setStatus('active')
    })
    await vi.waitFor(() => expect(capture.current?.state.filteredTasks).toHaveLength(1))
    await act(async () => {
      void capture.current!.loadMore()
      capture.current!.setStatus('paused')
    })
    pausedPage.resolve({ tasks: [paused], total: 1 })
    await vi.waitFor(() => expect(capture.current?.state.filteredTasks).toEqual([paused]))
    activeMore.resolve({ tasks: [task('task-active-late', 'active')], total: 2, nextCursor: 'late-active-cursor' })
    await act(async () => {
      await Promise.resolve()
    })

    expect(capture.current!.state.filteredTasks).toEqual([paused])
    expect(capture.current!.hasMore).toBe(false)
    const pageCalls = api.listTasks.mock.calls.length
    await act(async () => {
      await capture.current!.loadMore()
    })
    expect(api.listTasks).toHaveBeenCalledTimes(pageCalls)
  })

  it('filters the loaded page by name locally and clears every filter back to the unfiltered page', async () => {
    const first = task('task-1', 'active', '每日行情总结')
    const second = task('task-2', 'active', 'Weekly Crypto Digest')
    api.getPolicy.mockResolvedValue({ preset: 'balanced', policy: policy() })
    api.getLogs.mockResolvedValue({ logs: [], total: 0 })
    api.listAudits.mockResolvedValue({ audits: [], total: 0 })
    api.listTasks.mockResolvedValue({ tasks: [first, second], total: 2 })

    const capture = await mountHook()
    await vi.waitFor(() => expect(capture.current?.state.filteredTasks).toHaveLength(2))

    const pageCalls = api.listTasks.mock.calls.length
    await act(async () => {
      capture.current!.setNameQuery('crypto')
    })
    expect(capture.current!.state.filteredTasks).toEqual([second])
    expect(api.listTasks).toHaveBeenCalledTimes(pageCalls)

    await act(async () => {
      capture.current!.setStatus('active')
    })
    await vi.waitFor(() => expect(capture.current?.status).toBe('active'))
    await act(async () => {
      capture.current!.clearFilters()
    })
    await vi.waitFor(() => expect(capture.current?.status).toBe('all'))
    expect(capture.current!.nameQuery).toBe('')
    expect(capture.current!.state.filteredTasks).toHaveLength(2)
  })

  it('reloads snapshots and audits for the expanded task when reload runs', async () => {
    const only = task('task-1', 'active')
    let version = 1
    api.getPolicy.mockResolvedValue({ preset: 'balanced', policy: policy() })
    api.listTasks.mockResolvedValue({ tasks: [only], total: 1 })
    api.getLogs.mockImplementation(async () => ({ logs: [{ id: `run-${version}`, status: 'completed', startedAt: '2026-07-17T08:00:00.000Z' }], total: 1 }))
    api.getAttempts.mockImplementation(async () => ({
      attempts: [{ id: `attempt-${version}`, taskId: only.id, status: version === 1 ? 'failed' : 'delivered' }],
      total: 1
    }))
    api.listAudits.mockImplementation(async () => ({ audits: [{ id: `audit-${version}`, taskId: only.id }], total: 1 }))

    const capture = await mountHook()
    await vi.waitFor(() => expect(capture.current?.state.aggregateHealth.failed).toBe(1))
    await act(async () => {
      capture.current!.toggleTaskExpanded(only.id)
    })
    await vi.waitFor(() => expect(capture.current?.audits).toHaveLength(1))

    version = 2
    await act(async () => {
      await capture.current!.reload()
    })

    await vi.waitFor(() => expect(capture.current?.audits).toEqual([{ id: 'audit-2', taskId: only.id }]))
    await vi.waitFor(() => expect(capture.current?.state.aggregateHealth.delivered).toBe(1))
    expect(capture.current!.state.aggregateHealth.failed).toBe(0)
  })

  it('keeps the newest policy update when an older response arrives last', async () => {
    const balanced = deferred<{ preset: 'balanced'; policy: Record<string, number> }>()
    const conservative = deferred<{ preset: 'conservative'; policy: Record<string, number> }>()
    api.getPolicy.mockResolvedValue({ preset: 'balanced', policy: policy() })
    api.listTasks.mockResolvedValue({ tasks: [], total: 0 })
    api.updatePolicy.mockImplementation((_platform, preset) => preset === 'balanced' ? balanced.promise : conservative.promise)

    const capture = await mountHook()
    await vi.waitFor(() => expect(capture.current?.loading).toBe(false))
    await act(async () => {
      void capture.current!.updatePolicy('balanced')
      void capture.current!.updatePolicy('conservative')
    })
    conservative.resolve({ preset: 'conservative', policy: policy() })
    await vi.waitFor(() => expect(capture.current?.policy?.preset).toBe('conservative'))
    balanced.resolve({ preset: 'balanced', policy: policy() })
    await act(async () => {
      await Promise.resolve()
    })

    expect(capture.current!.policy?.preset).toBe('conservative')
  })

  it('exposes the policy loading state and retries a failed policy read', async () => {
    const firstRead = deferred<{ preset: 'balanced'; policy: Record<string, number> }>()
    api.getPolicy.mockReturnValueOnce(firstRead.promise)
    api.listTasks.mockResolvedValue({ tasks: [], total: 0 })

    const capture = await mountHook()
    expect(capture.current!.policyLoading).toBe(true)
    firstRead.resolve({ preset: 'balanced', policy: policy() })
    await vi.waitFor(() => expect(capture.current?.policyLoading).toBe(false))

    api.getPolicy.mockRejectedValueOnce(new Error('policy-read-failed /private/secret'))
    await act(async () => {
      await capture.current!.reloadPolicy()
    })
    expect(capture.current!.policyError).toBe(true)

    api.getPolicy.mockResolvedValueOnce({ preset: 'conservative', policy: policy() })
    await act(async () => {
      await capture.current!.reloadPolicy()
    })
    expect(capture.current!.policyError).toBe(false)
    expect(capture.current!.policy?.preset).toBe('conservative')
  })

  it('normalizes a policy update failure into the policy error state', async () => {
    api.getPolicy.mockResolvedValue({ preset: 'balanced', policy: policy() })
    api.listTasks.mockResolvedValue({ tasks: [], total: 0 })
    api.updatePolicy.mockRejectedValue(new Error('disk-full /private/secret'))

    const capture = await mountHook()
    await vi.waitFor(() => expect(capture.current?.loading).toBe(false))
    await act(async () => {
      await capture.current!.updatePolicy('conservative')
    })
    expect(capture.current!.policyError).toBe(true)
  })

  it('leaves loading when the bridge helpers throw synchronously', async () => {
    // 与 useResourceJobSchedules 同一类风险：同步抛也必须收敛 loading，不能永久转圈。
    api.listTasks.mockImplementation(() => {
      throw new Error('sync-task-page-bridge-missing')
    })
    api.getPolicy.mockImplementation(() => {
      throw new Error('sync-policy-bridge-missing')
    })

    const capture = await mountHook()

    await vi.waitFor(() => expect(capture.current?.loading).toBe(false), { timeout: 2_000 })
    expect(capture.current?.error).toBe(true)
    await vi.waitFor(() => expect(capture.current?.policyLoading).toBe(false), { timeout: 2_000 })
    expect(capture.current?.policyError).toBe(true)
    expect(capture.current?.policy).toBeNull()
  })
})

async function mountHook(): Promise<{ current: ReturnType<typeof useTaskAutomationSettings> | null }> {
  const capture: { current: ReturnType<typeof useTaskAutomationSettings> | null } = { current: null }
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(Harness, { capture }))
  })
  return capture
}

function Harness({ capture }: { capture: { current: ReturnType<typeof useTaskAutomationSettings> | null } }): null {
  const value = useTaskAutomationSettings()
  useEffect(() => {
    capture.current = value
  }, [capture, value])
  return null
}

function policy(): Record<string, number> {
  return {
    maxActiveTasksPerAgent: 30,
    minimumRecurringIntervalMs: 300_000,
    maximumTimeoutMinutes: 120,
    maxChannelsPerTask: 10
  }
}

function task(id: string, status: ScheduledTaskEntity['status'], name?: string): ScheduledTaskEntity {
  return {
    id, agentId: `${id}-agent`, name: name ?? id, prompt: 'Run', trigger: { kind: 'interval', ms: 60_000 }, timeoutMinutes: 5,
    workspace: { type: 'system' }, enabled: true, status, createdAt: '2026-07-17T00:00:00.000Z', updatedAt: '2026-07-17T00:00:00.000Z'
  }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  return { promise: new Promise<T>((nextResolve) => { resolve = nextResolve }), resolve }
}
