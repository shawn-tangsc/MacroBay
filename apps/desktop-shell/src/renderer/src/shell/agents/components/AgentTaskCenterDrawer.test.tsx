// @vitest-environment happy-dom

import { act, createElement, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AgentEntity } from '@platform/ai/agent-platform/schemas/agentSchemas'
import type { ScheduledTaskEntity, TaskRunLogEntity } from '@platform/ai/agent-platform/schemas/taskSchemas'
import { createAgentStoreState } from '@platform/ai/agent-platform/store/agentStore'

import { resolveStateViewText, STATE_VIEW_ACTION_KEYS } from '@platform/ui/components/state'

import { agentTextEnWorkbench } from '../agentTextEnWorkbench'

// 确认框由 Provider 渲染；这组用例不点删除，只要一个不抛错的实例。
vi.mock('@platform/ui/components/confirm', () => ({ useConfirm: () => vi.fn() }))

const api = vi.hoisted(() => ({
  getLogs: vi.fn(),
  listJobs: vi.fn(),
  listTasks: vi.fn(),
  retry: vi.fn()
}))

vi.mock('antd', () => ({
  Button: ({ children, onClick, ...props }: { children: ReactNode; onClick?: () => void }) =>
    createElement('button', { ...props, onClick }, children),
  // 平台抽屉把标题与右侧动作放在 antd 的 `title` / `extra` 上，只渲染 children 会让标题行整条消失。
  Drawer: ({ children, title, extra }: { children: ReactNode; title?: ReactNode; extra?: ReactNode }) =>
    createElement('div', null, title ?? null, extra ?? null, children),
  Tag: ({ children }: { children: ReactNode }) => createElement('span', null, children),
  // 平台抽屉的关闭键是一个 IconButton，IconButton 从 antd 取 Tooltip；缺了它渲染直接抛。
  Tooltip: ({ children }: { children: ReactNode }) => children
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

  it('shows only the loading surface before the first page arrives', async () => {
    // 首帧判据：数据还没回来时，屏幕上不许出现「这里还没有任务」，也不许出现「读取失败」。
    // 把它写成用例而不是靠眼睛看，是因为 `useEffect` 在首帧之后才跑——初值写 `false` 的每一次
    // 都会先画一遍空态，而人眼只看到「闪了一下」。
    const task = taskFixture()
    let resolveTasks: (page: { tasks: ScheduledTaskEntity[]; total: number }) => void = () => {}
    api.listTasks.mockReturnValue(
      new Promise((resolve) => {
        resolveTasks = resolve
      })
    )
    api.getLogs.mockResolvedValue({ logs: [], total: 0 })
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

    expect(container.querySelector('.loading-state')).not.toBeNull()
    expect(container.querySelector('[data-state="empty"]')).toBeNull()
    expect(container.querySelector('[data-state="error"]')).toBeNull()

    await act(async () => {
      resolveTasks({ tasks: [task], total: 1 })
    })
    await vi.waitFor(() => {
      expect([...container.querySelectorAll('button')].some((button) => button.textContent?.includes(task.name))).toBe(true)
    })
    expect(container.querySelector('.loading-state')).toBeNull()
    expect(container.querySelector('[data-state="empty"]')).toBeNull()

    await act(async () => root.unmount())
  })

  it('replaces the first load failure with an error and a retry that refetches', async () => {
    // 失败分两种：手里没有读数才是错误（给重试），手里有旧读数只是「上一次的结果」。
    // 这条钉的是第一种：错误 + 动作，且动作真的再读一次。
    const task = taskFixture()
    api.listTasks.mockRejectedValueOnce(new Error('offline'))
    api.listTasks.mockResolvedValueOnce({ tasks: [task], total: 1 })
    api.getLogs.mockResolvedValue({ logs: [], total: 0 })
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

    await vi.waitFor(() => {
      expect(container.querySelector('[data-state="error"]')).not.toBeNull()
    })
    expect(container.querySelector('[data-state="empty"]')).toBeNull()

    const retryLabel = resolveStateViewText('zh-CN', STATE_VIEW_ACTION_KEYS.retry)
    expect(container.textContent).toContain(retryLabel)
    await act(async () => {
      clickButton(container, retryLabel)
    })
    await vi.waitFor(() => {
      expect([...container.querySelectorAll('button')].some((button) => button.textContent?.includes(task.name))).toBe(true)
    })
    expect(container.querySelector('[data-state="error"]')).toBeNull()
    expect(api.listTasks).toHaveBeenCalledTimes(2)

    await act(async () => root.unmount())
  })

  it('keeps the last reading on screen when a refresh fails, and says it is stale', async () => {
    // 有旧读数时刷新失败，不许把列表换成错误视图：那等于用一次刷新失败惩罚用户已经读到的东西。
    const task = taskFixture()
    api.listTasks.mockResolvedValueOnce({ tasks: [task], total: 1 })
    api.getLogs.mockResolvedValue({ logs: [], total: 0 })
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
    await vi.waitFor(() => {
      expect([...container.querySelectorAll('button')].some((button) => button.textContent?.includes(task.name))).toBe(true)
    })

    api.listTasks.mockRejectedValueOnce(new Error('offline'))
    await act(async () => {
      clickButton(container, agentTextEnWorkbench.taskCenter.refresh)
    })

    await vi.waitFor(() => {
      expect(container.textContent).toContain(agentTextEnWorkbench.taskCenter.staleDataNotice)
    })
    expect(container.querySelector('[data-state="error"]')).toBeNull()
    expect([...container.querySelectorAll('button')].some((button) => button.textContent?.includes(task.name))).toBe(true)

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
