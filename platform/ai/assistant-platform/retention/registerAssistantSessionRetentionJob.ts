import type { JobRuntime } from '@platform/jobs'

import type { RetentionRepository } from '../repositories/retentionRepository'
import { applySessionRetention, DEFAULT_ASSISTANT_SESSION_RETENTION } from './assistantSessionRetention'

export const assistantSessionRetentionJobId = 'assistant.sessionRetention'

/**
 * 每天一次会话保留期裁剪。挂在 `@platform/jobs` 上，不自造定时器——
 * 开关、跳过与失败重试都由任务运行时负责，这里只做业务。
 */
export function registerAssistantSessionRetentionJob(
  jobRuntime: JobRuntime,
  deps: Readonly<{ repo: RetentionRepository; now?: () => Date }>
): void {
  jobRuntime.registerHandler(assistantSessionRetentionJobId, async (_payload, context) => {
    const outcome = applySessionRetention(
      deps.repo,
      DEFAULT_ASSISTANT_SESSION_RETENTION,
      (deps.now ?? (() => new Date()))()
    )
    await context.log({
      level: 'info',
      message: `Assistant session retention: ${outcome.deletedTopics} conversation(s), ${outcome.deletedMessages} message(s).`
    })
  })

  jobRuntime.setSchedule({
    id: assistantSessionRetentionJobId,
    owner: 'platform',
    handlerId: assistantSessionRetentionJobId,
    title: 'Assistant session retention',
    audience: 'internal' as const,
    trigger: { kind: 'cron', expression: '20 3 * * *' },
    payload: {}
  })
}
