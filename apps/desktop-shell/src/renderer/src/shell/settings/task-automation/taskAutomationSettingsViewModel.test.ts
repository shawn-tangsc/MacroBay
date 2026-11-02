import { collectDeliverySkipReasons } from './taskAutomationSettingsViewModel'
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

  it('decides the empty state from the source and the visible rows, never from the filter alone', () => {
    // Existence comes from the source only. Zero tasks is "nothing created yet" even with a filter
    // active: telling the reader to clear a filter that reveals nothing hides the truth.
    expect(resolveTaskEmptyState({ loadedCount: 0, visibleCount: 0 })).toBe('never-created')
    // Only "the source has rows, none of them visible" is a filter without matches.
    expect(resolveTaskEmptyState({ loadedCount: 3, visibleCount: 0 })).toBe('filter-empty')
    expect(resolveTaskEmptyState({ loadedCount: 3, visibleCount: 2 })).toBe('none')
    expect(resolveTaskEmptyState({ loadedCount: 0, visibleCount: 0 })).not.toBe('none')
  })

  it('keeps the table visible when a status filter still matches rows', () => {
    const active = task({ id: 'task-active', status: 'active' })
    const paused = task({ id: 'task-paused', status: 'paused' })

    // Regression: an active filter used to mean "filter-empty" even when rows matched, which hid
    // the whole table behind a "no tasks match" block.
    const state = buildTaskAutomationSettingsState({
      tasks: [active, paused], selectedTaskId: null, status: 'active', nameQuery: '', audits: [], taskRuns: {}
    })

    expect(state.filteredTasks).toEqual([active])
    expect(state.emptyState).toBe('none')
  })

  it('reports a filtered-out list when the source has rows but the filter matches none', () => {
    const state = buildTaskAutomationSettingsState({
      tasks: [task({ id: 'task-1', name: 'First' })],
      selectedTaskId: null,
      status: 'all',
      nameQuery: 'zzz',
      audits: [],
      taskRuns: {}
    })

    expect(state.emptyState).toBe('filter-empty')
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
          health: { delivered: 1, failed: 0, pending: 0, skipped: 0, unknown: 1 },
          skipReasons: [],
          unexplainedSkips: 0
        },
        [second.id]: {
          status: 'completed',
          at: '2026-07-17T09:00:00.000Z',
          health: { delivered: 2, failed: 0, pending: 1, skipped: 1, unknown: 0 },
          skipReasons: [],
          unexplainedSkips: 0
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

  it('keeps a row whose latest run could not be read, marked unreadable, without inventing counts', () => {
    const readable = task({ id: 'task-1', name: 'Readable' })
    const unreadable = task({ id: 'task-2', name: 'Unreadable' })
    const never = task({ id: 'task-3', name: 'Never' })
    const state = buildTaskAutomationSettingsState({
      tasks: [readable, unreadable, never],
      selectedTaskId: unreadable.id,
      status: 'all',
      nameQuery: '',
      audits: [],
      taskRuns: {
        [readable.id]: snapshot({ delivered: 2 }),
        [unreadable.id]: { unreadable: true }
      }
    })

    // The row is present and distinguishable from "never ran", which is the fact the old code
    // silently replaced it with by dropping the entry.
    expect(state.rows.map((row) => [row.task.id, row.runUnreadable, row.lastRun])).toEqual([
      ['task-1', false, expect.objectContaining({ status: 'completed' })],
      ['task-2', true, null],
      ['task-3', false, null]
    ])
    // An unreadable run adds nothing to the aggregate: zero-filling it would report a silent pass.
    expect(state.aggregateHealth.delivered).toBe(2)
    expect(state.deliveryHealth).toEqual({ delivered: 0, failed: 0, pending: 0, skipped: 0, unknown: 0 })
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
    health: { delivered: 0, failed: 0, pending: 0, skipped: 0, unknown: 0, ...health },
    skipReasons: [],
    unexplainedSkips: 0
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

describe('collectDeliverySkipReasons', () => {
  const attempt = (status: string, errorCode: string | null) =>
    ({ status, errorCode }) as Parameters<typeof collectDeliverySkipReasons>[0][number]

  it('names the reasons it can explain, deduplicated', () => {
    const result = collectDeliverySkipReasons([
      attempt('skipped-no-active-target', 'delivery-no-target-bound'),
      attempt('skipped-channel-inactive', 'delivery-target-disabled'),
      attempt('skipped-channel-inactive', 'delivery-target-disabled')
    ])

    expect(result.skipReasons).toEqual(['delivery-no-target-bound', 'delivery-target-disabled'])
    expect(result.unexplainedSkips).toBe(0)
  })

  // A skipped delivery without a reason is a writer defect: count it so the surface can say so.
  it('counts skips whose reason is missing or is not a known code', () => {
    const result = collectDeliverySkipReasons([
      attempt('skipped-no-active-target', null),
      attempt('skipped-no-active-target', 'some-future-code'),
      attempt('delivered', null)
    ])

    expect(result.skipReasons).toEqual([])
    expect(result.unexplainedSkips).toBe(2)
  })
})
