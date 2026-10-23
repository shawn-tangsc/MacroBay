// @vitest-environment happy-dom

import { act, createElement, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AgentEntity } from '@platform/ai/agent-platform/schemas/agentSchemas'
import type { ScheduledTaskEntity, TaskRunLogEntity } from '@platform/ai/agent-platform/schemas/taskSchemas'
import { createAgentStoreState } from '@platform/ai/agent-platform/store/agentStore'

import { agentTextEnWorkbench } from '../agentTextEnWorkbench'

const api = vi.hoisted(() => ({
  getLogs: vi.fn(),
  listJobs: vi.fn(),
  listTasks: vi.fn(),
  retry: vi.fn()
}))

vi.mock('antd', () => ({
  Button: ({ children, onClick, ...props }: { children: ReactNode; onClick?: () => void }) =>
    createElement('button', { ...props, onClick }, children),
  Drawer: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  Tag: ({ children }: { children: ReactNode }) => createElement('span', null, children)
}))

vi.mock('../agentTextProvider', () => ({
  useAgentText: () => agentTextEnWorkbench
}))

vi.mock('../agentTaskDataApi', () => ({
  cancelTaskRunViaApi: vi.fn(),
  createTaskViaApi: vi.fn(),
  deleteTaskViaApi: vi.fn(),
  getTaskLogsViaApi: api.getLogs,
  isTaskRevisionConflict: () => false,
  listTaskJobPageViaApi: api.listJobs,
  listTasksViaApi: api.listTasks,
  runTaskViaApi: vi.fn(),
  updateTaskViaApi: vi.fn()
}))

vi.mock('../agentSessionDataApi', () => ({
  selectSessionViaApi: vi.fn()
}))

vi.mock('./AgentTaskDraftForm', () => ({
  default: () => createElement('div')
}))

vi.mock('./useAgentTaskRuntimeSignals', () => ({
  useAgentTaskRuntimeSignals: () => ({ schedulePreview: null, deliveryReadiness: [] })
}))

vi.mock('./useAgentTaskDeliveryAttempts', () => ({
  useAgentTaskDeliveryAttempts: ({ runLogId }: { runLogId: string | null }) => ({
    attempts: runLogId === 'run-history-11' ? [{ id: 'attempt-history-11' }] : [],
    total: runLogId === 'run-history-11' ? 1 : 0,
    loadMore: vi.fn(),
    retry: async (attemptId: string) => {
      api.retry(runLogId, attemptId)
      return { delivered: 1, failed: 0, skipped: 0, unknown: 0 }
    }
  })
}))

vi.mock('./AgentTaskRunSection', () => ({
  default: ({
    logs,
    selectedRunLogId,
    attempts,
    onSelectRun,
    onRetryDelivery
  }: {
    logs: TaskRunLogEntity[]
    selectedRunLogId: string | null
    attempts: Array<{ id: string }>
    onSelectRun: (runLogId: string) => void
    onRetryDelivery: (attemptId: string) => void
  }) =>
    createElement(
      'section',
      { 'data-selected-run': selectedRunLogId ?? '' },
      logs.map((log) =>
        createElement(
          'button',
          { key: log.id, type: 'button', onClick: () => onSelectRun(log.id) },
          `${log.id}:${log.deliverySummary?.delivered ?? 0}/${log.deliverySummary?.failed ?? 0}`
        )
      ),
      attempts.map((attempt) =>
        createElement('button', { key: attempt.id, type: 'button', onClick: () => onRetryDelivery(attempt.id) }, attempt.id)
      )
    )
}))

import AgentTaskCenterDrawer from './AgentTaskCenterDrawer'

describe('AgentTaskCenterDrawer', () => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

  afterEach(() => {
    api.getLogs.mockReset()
    api.listJobs.mockReset()
    api.listTasks.mockReset()
    api.retry.mockReset()
    document.body.replaceChildren()
  })

  it('keeps a loaded historical run selected and refreshed after retrying its failed delivery', async () => {
    const task = taskFixture()
    const firstPage = Array.from({ length: 10 }, (_, index) => logFixture({
      id: index === 0 ? 'run-latest' : `run-history-${index}`,
      scheduleId: task.id,
      startedAt: `2026-07-17T${String(10 - index).padStart(2, '0')}:00:00.000Z`,
      deliverySummary: { delivered: 0, failed: 0, skipped: 0, unknown: 0 }
    }))
    const selected = logFixture({
      id: 'run-history-11',
      scheduleId: task.id,
      startedAt: '2026-07-16T00:00:00.000Z',
      deliverySummary: { delivered: 0, failed: 1, skipped: 0, unknown: 0 }
    })
    api.listTasks.mockResolvedValue({ tasks: [task], total: 1 })
    api.getLogs.mockResolvedValueOnce({ logs: firstPage, total: 11 })
    api.getLogs.mockResolvedValueOnce({ logs: [selected], total: 11 })
    api.getLogs.mockResolvedValueOnce({
      logs: [{ ...selected, deliverySummary: { delivered: 1, failed: 1, skipped: 0, unknown: 0 } }],
      total: 11
    })
    api.listJobs.mockResolvedValue({ runs: [] })

    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(createElement(AgentTaskCenterDrawer, {
        open: true,
        state: createAgentStoreState({ workspaces: [] }),
        agent: agentFixture(),
        workspace: { type: 'system' },
        onClose: vi.fn(),
        onStateChange: vi.fn()
      }))
    })
    expect(api.listTasks).toHaveBeenCalledOnce()
    expect(api.getLogs).toHaveBeenCalledOnce()
    await vi.waitFor(() => {
      expect([...container.querySelectorAll('button')].some((button) => button.textContent?.includes(task.name))).toBe(true)
    })
    await act(async () => {
      clickButtonContaining(container, task.name)
    })
    await vi.waitFor(() => {
      expect([...container.querySelectorAll('button')].some((button) => button.textContent === agentTextEnWorkbench.taskCenter.loadMoreRuns)).toBe(true)
    })

    await act(async () => {
      clickButton(container, agentTextEnWorkbench.taskCenter.loadMoreRuns)
    })
    await vi.waitFor(() => {
      expect([...container.querySelectorAll('button')].some((button) => button.textContent?.startsWith(`${selected.id}:`))).toBe(true)
    })
    await act(async () => {
      clickButtonContaining(container, `${selected.id}:`)
    })
    expect(container.querySelector('[data-selected-run]')?.getAttribute('data-selected-run')).toBe(selected.id)

    await act(async () => {
      clickButton(container, 'attempt-history-11')
    })

    expect(api.retry).toHaveBeenCalledWith(selected.id, 'attempt-history-11')
    expect(api.listTasks).toHaveBeenCalledOnce()
    expect(api.getLogs).toHaveBeenCalledTimes(3)
    expect(api.getLogs).toHaveBeenLastCalledWith(window.platform, 'agent-1', task.id, { limit: 1, offset: 10 })
    expect(container.querySelector('[data-selected-run]')?.getAttribute('data-selected-run')).toBe(selected.id)
    expect(container.textContent).toContain(`${selected.id}:1/1`)
    expect(container.textContent).toContain('run-latest:0/0')

    await act(async () => root.unmount())
  })
})

function clickButton(container: Element, label: string): void {
  const button = [...container.querySelectorAll('button')].find((element) => element.textContent === label)
  if (!button) throw new Error(`Missing button: ${label}`)
  button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

function clickButtonContaining(container: Element, label: string): void {
  const button = [...container.querySelectorAll('button')].find((element) => element.textContent?.includes(label))
  if (!button) throw new Error(`Missing button containing: ${label}`)
  button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

function agentFixture(): AgentEntity {
  return {
    id: 'agent-1',
    name: 'Agent',
    type: 'claude-code',
    description: '',
    model: null,
    modelName: null,
    orderKey: 'a',
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z'
  }
}

function taskFixture(): ScheduledTaskEntity {
  return {
    id: 'task-1',
    agentId: 'agent-1',
    name: 'Task',
    prompt: 'Run',
    trigger: { kind: 'interval', ms: 60_000 },
    timeoutMinutes: 5,
    workspace: { type: 'system' },
    enabled: true,
    status: 'active',
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z'
  }
}

function logFixture(overrides: Partial<TaskRunLogEntity>): TaskRunLogEntity {
  return {
    id: 'run-1',
    scheduleId: 'task-1',
    startedAt: '2026-07-16T00:00:00.000Z',
    durationMs: 1,
    status: 'completed',
    ...overrides
  }
}
