import { renderToStaticMarkup } from 'react-dom/server'

import { describe, expect, it, vi } from 'vitest'

import { agentTextEnWorkbench } from '../agentTextEnWorkbench'
import { agentTextZhWorkbench } from '../agentTextZhWorkbench'
import type { AgentTaskCenterItem } from '../agentTaskCenterViewModel'
import AgentTaskRunSection from './AgentTaskRunSection'

const queuedItem: AgentTaskCenterItem = {
  task: {
    id: 'task-1', agentId: 'agent-1', name: 'Queued task', prompt: 'Run', trigger: { kind: 'interval', ms: 300_000 },
    timeoutMinutes: 2, workspace: { type: 'system' }, enabled: true, status: 'active', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z'
  },
  triggerLabel: 'Every 5 minutes',
  latestRunLogId: 'run-queued',
  latestJobRunId: null,
  latestOutput: 'Waiting to run',
  runtimeStatus: 'queued',
  isRunning: true,
  isOverdue: false
}

describe('AgentTaskRunSection', () => {
  it('treats queued work as active and renders preview-only and skipped run states without error styling', () => {
    const markup = renderToStaticMarkup(
      <AgentTaskRunSection
        item={queuedItem}
        logs={[
          { id: 'run-queued', scheduleId: 'task-1', startedAt: '2026-01-01T00:00:00.000Z', durationMs: 0, status: 'queued', resultPreview: 'Waiting to run' },
          { id: 'run-skipped', scheduleId: 'task-1', startedAt: '2026-01-01T00:01:00.000Z', durationMs: 0, status: 'skipped', resultPreview: 'No active channel' }
        ]}
        jobsByRunLogId={{}}
        labels={agentTextEnWorkbench.taskCenter}
        saving={false}
        selectedRunLogId="run-skipped"
        attempts={[
          {
            id: 'attempt-failed', runLogId: 'run-skipped', taskId: 'task-1', agentId: 'agent-1', taskNameSnapshot: 'Queued task',
            channelId: 'channel-1', targetHash: 'target', status: 'failed', attemptNumber: 2, startedAt: '2026-01-01T00:01:00.000Z'
          }
        ]}
        attemptsTotal={2}
        onLoadMoreAttempts={vi.fn()}
        onSelectRun={vi.fn()}
        onRetryDelivery={vi.fn()}
        onOpenSession={vi.fn()}
        onRun={vi.fn()}
        onCancel={vi.fn()}
        onDelete={vi.fn()}
      />
    )

    expect(markup).toContain('Stop run')
    expect(markup).not.toContain('>Run now<')
    expect(markup).toContain('Waiting to run')
    expect(markup).toContain('No active channel')
    expect(markup).toContain('agent-task-run-status queued')
    expect(markup).toContain('agent-task-run-status skipped')
    expect(markup).toContain('Delivery attempts')
    expect(markup).toContain('Retry delivery')
    expect(markup).toContain('Load more attempts')
  })

  it('renders localized delivery summaries and an immutable completed task action state', () => {
    const item: AgentTaskCenterItem = {
      ...queuedItem,
      task: { ...queuedItem.task, status: 'completed' },
      runtimeStatus: 'completed',
      isRunning: false
    }
    const markup = renderToStaticMarkup(
      <AgentTaskRunSection
        item={item}
        logs={[{
          id: 'run-completed', scheduleId: 'task-1', sessionId: 'session-1', startedAt: '2026-01-01T00:00:00.000Z', durationMs: 1,
          status: 'completed', deliverySummary: { delivered: 1, failed: 2, skipped: 3, unknown: 4 }
        }]}
        jobsByRunLogId={{}}
        labels={agentTextZhWorkbench.taskCenter}
        saving={false}
        selectedRunLogId="run-completed"
        attempts={[]}
        attemptsTotal={0}
        onLoadMoreAttempts={vi.fn()}
        onSelectRun={vi.fn()}
        onRetryDelivery={vi.fn()}
        onOpenSession={vi.fn()}
        onRun={vi.fn()}
        onCancel={vi.fn()}
        onDelete={vi.fn()}
      />
    )

    expect(markup).toContain('投递：1 成功，2 失败，3 跳过，4 未知')
    expect(markup).toContain('打开会话')
    expect(markup).toContain('立即运行')
    expect(markup).toContain('disabled')
  })

  it('binds the visible delivery attempts and retry action to the selected older run', () => {
    const selectRun = vi.fn()
    const retryDelivery = vi.fn()
    const markup = renderToStaticMarkup(
      <AgentTaskRunSection
        item={{ ...queuedItem, runtimeStatus: 'completed', isRunning: false }}
        logs={[
          { id: 'run-latest', scheduleId: 'task-1', startedAt: '2026-01-02T00:00:00.000Z', durationMs: 1, status: 'completed' },
          { id: 'run-older', scheduleId: 'task-1', startedAt: '2026-01-01T00:00:00.000Z', durationMs: 1, status: 'completed' }
        ]}
        jobsByRunLogId={{}}
        labels={agentTextEnWorkbench.taskCenter}
        saving={false}
        selectedRunLogId="run-older"
        attempts={[{
          id: 'older-failed-attempt', runLogId: 'run-older', taskId: 'task-1', agentId: 'agent-1', taskNameSnapshot: 'Queued task',
          channelId: 'channel-1', targetHash: 'target', status: 'failed', attemptNumber: 1, startedAt: '2026-01-01T00:00:00.000Z'
        }]}
        attemptsTotal={1}
        onLoadMoreAttempts={vi.fn()}
        onSelectRun={selectRun}
        onRetryDelivery={retryDelivery}
        onOpenSession={vi.fn()}
        onRun={vi.fn()}
        onCancel={vi.fn()}
        onDelete={vi.fn()}
      />
    )

    expect(markup).toContain('aria-pressed="true"')
    expect(markup).toContain('channel-1 · Attempt 1')
    expect(markup).toContain('Retry delivery')
  })
})
