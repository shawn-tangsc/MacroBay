import { describe, expect, it } from 'vitest'

import type { ScheduledTaskEntity } from '@platform/ai/agent-platform/schemas/taskSchemas'

import {
  buildTaskAutomationSettingsState,
  resolveTaskEmptyState,
  type TaskRunSnapshot
} from './taskAutomationSettingsViewModel'

describe('taskAutomationSettingsViewModel', () => {
  it('filters the loaded page by the selected status and scopes audit and delivery health to the expanded task', () => {
    const active = task({ id: 'task-active', status: 'active' })
    const paused = task({ id: 'task-paused', status: 'paused' })
    const state = buildTaskAutomationSettingsState({
      tasks: [active, paused],
      selectedTaskId: active.id,
      status: 'active',
      nameQuery: '',
      audits: [{ id: 'audit-1', taskId: active.id, action: 'update', outcome: 'accepted', errorCode: null }],
      taskRuns: {
        [active.id]: snapshot({ delivered: 1, failed: 1 }),
        [paused.id]: snapshot({ delivered: 9 })
      }
    })

    expect(state.filteredTasks).toEqual([active])
    expect(state.selectedTask).toEqual(active)
    expect(state.expandedTaskId).toBe(active.id)
    expect(state.auditCount).toBe(1)
    expect(state.deliveryHealth).toEqual({ delivered: 1, failed: 1, pending: 0, skipped: 0, unknown: 0 })
    // 聚合覆盖所有已加载任务，不受状态筛选影响
    expect(state.aggregateHealth).toEqual({ delivered: 10, failed: 1, pending: 0, skipped: 0, unknown: 0 })
  })

  it('combines the status filter with a case-insensitive name substring filter', () => {
    const first = task({ id: 'task-1', name: '每日行情总结', status: 'active' })
    const second = task({ id: 'task-2', name: 'Weekly Crypto Digest', status: 'active' })
    const paused = task({ id: 'task-3', name: '每日行情总结（旧）', status: 'paused' })

    expect(buildTaskAutomationSettingsState({
      tasks: [first, second, paused], selectedTaskId: null, status: 'active', nameQuery: 'crypto', audits: [], taskRuns: {}
    }).filteredTasks).toEqual([second])

    expect(buildTaskAutomationSettingsState({
      tasks: [first, second, paused], selectedTaskId: null, status: 'active', nameQuery: '行情', audits: [], taskRuns: {}
    }).filteredTasks).toEqual([first])
  })

  it('distinguishes a never-created list from a filter without matches', () => {
    expect(resolveTaskEmptyState({ loadedCount: 0, status: 'all', nameQuery: '' })).toBe('never-created')
    expect(resolveTaskEmptyState({ loadedCount: 0, status: 'active', nameQuery: '' })).toBe('filter-empty')
    expect(resolveTaskEmptyState({ loadedCount: 0, status: 'all', nameQuery: 'zzz' })).toBe('filter-empty')
    expect(resolveTaskEmptyState({ loadedCount: 3, status: 'all', nameQuery: 'zzz' })).toBe('filter-empty')
    expect(resolveTaskEmptyState({ loadedCount: 3, status: 'all', nameQuery: '' })).toBe('none')
    expect(resolveTaskEmptyState({ loadedCount: 0, status: 'all', nameQuery: '' })).not.toBe('none')
  })

  it('counts unknown delivery statuses as unknown instead of skipped and reports the latest run time', () => {
    const first = task({ id: 'task-1', name: 'First' })
    const second = task({ id: 'task-2', name: 'Second' })
    const state = buildTaskAutomationSettingsState({
      tasks: [first, second],
      selectedTaskId: null,
      status: 'all',
      nameQuery: '',
      audits: [],
      taskRuns: {
        [first.id]: {
          status: 'failed',
          at: '2026-07-17T08:00:00.000Z',
          health: { delivered: 1, failed: 0, pending: 0, skipped: 0, unknown: 1 }
        },
        [second.id]: {
          status: 'completed',
          at: '2026-07-17T09:00:00.000Z',
          health: { delivered: 2, failed: 0, pending: 1, skipped: 1, unknown: 0 }
        }
      }
    })

    expect(state.rows.map((row) => [row.task.id, row.lastRun?.status ?? null])).toEqual([
      ['task-1', 'failed'],
      ['task-2', 'completed']
    ])
    expect(state.aggregateHealth).toEqual({ delivered: 3, failed: 0, pending: 1, skipped: 1, unknown: 1 })
    expect(state.latestRunAt).toBe('2026-07-17T09:00:00.000Z')
  })

  it('keeps no expansion and zeroed per-task health when nothing is expanded', () => {
    const state = buildTaskAutomationSettingsState({
      tasks: [task({ id: 'task-1' })],
      selectedTaskId: null,
      status: 'all',
      nameQuery: '',
      audits: [],
      taskRuns: { 'task-1': snapshot({ delivered: 4 }) }
    })

    expect(state.expandedTaskId).toBeNull()
    expect(state.selectedTask).toBeNull()
    expect(state.auditCount).toBe(0)
    expect(state.deliveryHealth).toEqual({ delivered: 0, failed: 0, pending: 0, skipped: 0, unknown: 0 })
    expect(state.aggregateHealth.delivered).toBe(4)
  })
})

function snapshot(health: Partial<TaskRunSnapshot['health']>): TaskRunSnapshot {
  return {
    status: 'completed',
    at: '2026-07-17T08:00:00.000Z',
    health: { delivered: 0, failed: 0, pending: 0, skipped: 0, unknown: 0, ...health }
  }
}

function task(overrides: Partial<ScheduledTaskEntity>): ScheduledTaskEntity {
  return {
    id: 'task-1', agentId: 'agent-1', name: 'Task', prompt: 'Run', trigger: { kind: 'interval', ms: 60_000 },
    timeoutMinutes: 5, workspace: { type: 'system' }, enabled: true, status: 'active',
    createdAt: '2026-07-17T00:00:00.000Z', updatedAt: '2026-07-17T00:00:00.000Z',
    ...overrides
  }
}
