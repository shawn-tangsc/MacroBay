import { randomUUID } from 'node:crypto'

import type { RetentionAuditEntry, RetentionRepository } from '../repositories/retentionRepository'

export type SessionRetentionReason = 'age' | 'message-count'

/** 单次扫描最多处理多少个会话；超出的留到次日。这是上限，不是目标。 */
export const MAX_SESSIONS_PER_RUN = 500

/** 裁剪记录自身的保留期：180 天或最近 500 条，先到为准。 */
export const AUDIT_RETENTION_DAYS = 180
export const AUDIT_MAX_ENTRIES = 500

export type AssistantSessionRetentionPolicy = {
  /** 会话最后更新时间早于这么多天即淘汰。 */
  maxAgeDays: number
  /** 单个会话最多保留多少条消息，超出部分裁剪。 */
  maxMessagesPerSession: number
}

/**
 * 起点参数，不是定论。调整前要过产品与架构师——会话是用户资产，改小等于删数据。
 */
export const DEFAULT_ASSISTANT_SESSION_RETENTION: AssistantSessionRetentionPolicy = {
  maxAgeDays: 365,
  maxMessagesPerSession: 10_000
}

export type SessionRetentionCandidate = {
  topicId: string
  /** 置顶会话永不自动淘汰。 */
  pinned: boolean
  updatedAt: string
  messageCount: number
}

export type SessionRetentionDecision = {
  topicId: string
  action: 'delete-topic' | 'trim-messages'
  /** 仅 `trim-messages` 时大于 0。 */
  dropMessages: number
  reason: SessionRetentionReason
  limitValue: number
}

/**
 * 纯规划：给定候选与策略，返回要做的动作。不读库、不删数据——执行归调用方，
 * 这样「删什么、为什么删」可以先被断言，再被落实。
 *
 * 判定顺序即「先到为准」：先看天数，再看条数。
 */
export function planSessionRetention(
  candidates: readonly SessionRetentionCandidate[],
  policy: AssistantSessionRetentionPolicy = DEFAULT_ASSISTANT_SESSION_RETENTION,
  now: Date = new Date()
): SessionRetentionDecision[] {
  const cutoffMs = now.getTime() - policy.maxAgeDays * 24 * 60 * 60 * 1000
  const decisions: SessionRetentionDecision[] = []

  for (const candidate of candidates) {
    if (candidate.pinned) continue

    if (Date.parse(candidate.updatedAt) < cutoffMs) {
      decisions.push({
        topicId: candidate.topicId,
        action: 'delete-topic',
        dropMessages: candidate.messageCount,
        reason: 'age',
        limitValue: policy.maxAgeDays
      })
      continue
    }

    if (candidate.messageCount > policy.maxMessagesPerSession) {
      decisions.push({
        topicId: candidate.topicId,
        action: 'trim-messages',
        dropMessages: candidate.messageCount - policy.maxMessagesPerSession,
        reason: 'message-count',
        limitValue: policy.maxMessagesPerSession
      })
    }
  }

  return decisions
}

export type SessionRetentionOutcome = {
  deletedTopics: number
  deletedMessages: number
  audits: RetentionAuditEntry[]
  prunedAudits: number
}

/**
 * 执行一次保留期裁剪，并把「删了多少、哪天、依据哪个上限」写成一条可查记录。
 *
 * 一次运行里同一种原因只留一条记录；记录先于/随删除一起写，免得删了却没有出处。
 */
export function applySessionRetention(
  repo: RetentionRepository,
  policy: AssistantSessionRetentionPolicy = DEFAULT_ASSISTANT_SESSION_RETENTION,
  now: Date = new Date()
): SessionRetentionOutcome {
  // 一次只处理上限以内的会话：删除是逐条语句，几万条会让写锁反复争用，用户体感是
  // 「那天早上应用卡」。剩下的次日再来，宁可慢一天，也不要卡一次。
  const decisions = planSessionRetention(repo.listCandidates(), policy, now).slice(0, MAX_SESSIONS_PER_RUN)
  const ranAt = now.toISOString()
  const cutoffAt = new Date(now.getTime() - policy.maxAgeDays * 24 * 60 * 60 * 1000).toISOString()

  const byReason = new Map<SessionRetentionReason, { topics: number; messages: number; limitValue: number }>()
  for (const decision of decisions) {
    const bucket = byReason.get(decision.reason) ?? {
      topics: 0,
      messages: 0,
      limitValue: decision.limitValue
    }
    if (decision.action === 'delete-topic') {
      repo.deleteTopic(decision.topicId)
      bucket.topics += 1
      bucket.messages += decision.dropMessages
    } else {
      bucket.messages += repo.trimMessages(decision.topicId, decision.dropMessages)
    }
    byReason.set(decision.reason, bucket)
  }

  const audits: RetentionAuditEntry[] = []
  for (const [reason, bucket] of byReason) {
    const entry: RetentionAuditEntry = {
      id: randomUUID(),
      ranAt,
      cutoffAt,
      reason,
      limitValue: bucket.limitValue,
      deletedTopics: bucket.topics,
      deletedMessages: bucket.messages
    }
    repo.appendAudit(entry)
    audits.push(entry)
  }

  // 记录表自己也要有人管：只增不减正是我们在清的那种病。清理在同一个任务里做，不另开 job。
  const prunedAudits = repo.pruneAudits(
    new Date(now.getTime() - AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    AUDIT_MAX_ENTRIES
  )

  return {
    deletedTopics: decisions.filter((decision) => decision.action === 'delete-topic').length,
    deletedMessages: audits.reduce((sum, audit) => sum + audit.deletedMessages, 0),
    audits,
    prunedAudits
  }
}
