import { createHash } from 'node:crypto'

import { ChannelDeliveryRepository, ChannelDeliveryService } from '../../ai/agent-platform/channels'
import type { AppLanguage } from '../../settings/schema/appSettings'

type TaskChannelDeliveryInput = {
  taskId: string
  taskNameSnapshot: string
  sourceTaskId: string | null
  agentId: string
  sessionId: string
  runLogId: string
  channelIds: string[]
  status: 'completed' | 'failed' | 'cancelled'
  text: string
  error: string | null
}

type Summary = { delivered: number; failed: number; skipped: number; unknown: number }

type TaskChannelDeliveryDependencies = {
  delivery?: ChannelDeliveryService
  repository?: ChannelDeliveryRepository
  // Compatibility-only test fixtures may still provide these obsolete fields; production ignores them.
  attempts?: unknown
  channels?: unknown
  resolveChannelHost?: unknown
  runs?: unknown
  readSessionMessages?: unknown
  patchDeliverySummary: (runLogId: string, summary: Summary) => Promise<void>
  getLanguage?: () => Promise<AppLanguage>
}

export type TaskChannelDelivery = {
  deliver: (input: TaskChannelDeliveryInput) => Promise<void>
  // The old task read surface remains callable; the unified ledger owns retry policy.
  retry: (agentId: string, runLogId: string, attemptId: string) => Promise<Summary>
}

export function createTaskChannelDelivery(deps: TaskChannelDeliveryDependencies): TaskChannelDelivery {
  return {
    async deliver(input): Promise<void> {
      if (!deps.delivery) throw new Error('channel-delivery-unavailable')
      const language = await deps.getLanguage?.() ?? 'en-US'
      const text = formatTaskChannelDeliveryMessage(input, language)
      const summary: Summary = { delivered: 0, failed: 0, skipped: 0, unknown: 0 }
      for (const channelId of [...new Set(input.channelIds)]) {
        const outcomes = await deps.delivery.deliverToEnabledTargets({
          channelId, agentId: input.agentId, source: 'task-result', sourceId: `${input.runLogId}:${input.status}`, text
        })
        for (const outcome of outcomes) {
          if (outcome.status === 'delivered') summary.delivered += 1
          else if (outcome.status === 'failed') summary.failed += 1
          else if (outcome.status === 'unknown-after-send') summary.unknown += 1
          else summary.skipped += 1
        }
      }
      await deps.patchDeliverySummary(input.runLogId, summary)
    },
    async retry(agentId: string, runLogId: string, attemptId: string): Promise<Summary> {
      if (!deps.delivery || !deps.repository || !deps.runs || !deps.readSessionMessages) return { delivered: 0, failed: 0, skipped: 0, unknown: 0 }
      const run = (deps.runs as { get: (id: string) => { agentId?: string | null; sessionId?: string | null; resultHash?: string | null; status: string } | null }).get(runLogId)
      const attempt = deps.repository.getTaskAttempt({ agentId, runLogId, attemptId })
      if (!run || run.agentId !== agentId || run.status !== 'completed' || !run.sessionId || !run.resultHash || !attempt || attempt.status !== 'unknown-after-send') {
        return { delivered: 0, failed: 0, skipped: 0, unknown: 0 }
      }
      const messages = await (deps.readSessionMessages as (sessionId: string) => Promise<Array<{ role: string; status: string; text: string }>>)(run.sessionId)
      const text = [...messages].reverse().find((message) => message.role === 'assistant' && message.status === 'success')?.text.trim()
      if (!text || createHash('sha256').update(text).digest('hex') !== run.resultHash) return { delivered: 0, failed: 0, skipped: 0, unknown: 0 }
      const status = sourceStatus(runLogId, attempt.sourceHash)
      if (!status) return { delivered: 0, failed: 0, skipped: 0, unknown: 0 }
      const outcome = await deps.delivery.deliver({ channelId: attempt.channelId, agentId, conversationId: attempt.conversationId, source: 'task-result', sourceId: `${runLogId}:${status}`, text, retryUnknown: true })
      const summary: Summary = { delivered: outcome.status === 'delivered' ? 1 : 0, failed: outcome.status === 'failed' ? 1 : 0, skipped: outcome.status === 'skipped' ? 1 : 0, unknown: outcome.status === 'unknown-after-send' ? 1 : 0 }
      await deps.patchDeliverySummary(runLogId, summary)
      return summary
    }
  }
}

function sourceStatus(runLogId: string, sourceHash: string): TaskChannelDeliveryInput['status'] | null {
  for (const status of ['completed', 'failed', 'cancelled'] as const) {
    if (createHash('sha256').update(`${runLogId}:${status}`).digest('base64url') === sourceHash) return status
  }
  return null
}

function formatTaskChannelDeliveryMessage(input: Pick<TaskChannelDeliveryInput, 'status' | 'text'>, language: AppLanguage): string {
  const localized = language === 'zh-CN'
    ? { cancelled: '定时任务已取消。', failed: '定时任务执行失败。', completed: '定时任务已完成。' }
    : { cancelled: 'Scheduled task cancelled.', failed: 'Scheduled task failed.', completed: 'Scheduled task completed.' }
  if (input.status === 'cancelled') return localized.cancelled
  if (input.status === 'failed') return localized.failed
  return input.text.trim() ? `${localized.completed}\n\n${input.text.trim()}` : localized.completed
}
