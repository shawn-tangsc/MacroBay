/**
 * 合并的**四条唯一写法**（契约 §16.2，别处只许引用）：
 *  1. 标题取第一次提交；
 *  2. 动作取第一次提交；
 *  3. 正文取最新一次；最新一次没有正文时保留既有；
 *  4. 次数与最近发生时间跟着更新；跨类型合并不增次数。
 *
 * 从 `notificationStore.ts` 抽出来：那份文件已经超过体积线，而合并规则自成一体的。
 * 抽出来之后 store 只留读写，规则只在这里——**别处引用，不复制**。
 */
import { PRIORITY_RANK, SEVERITY_RANK } from '../contracts/notificationContracts'
import type {
  NotificationChannel,
  NotificationContentByLanguage,
  NotificationPriority,
  NotificationRecord,
  NotificationRequest,
  NotificationSeverity
} from '../contracts/notificationContracts'

export function mergeDuplicateNotification(
  existing: NotificationRecord,
  incoming: NotificationRequest,
  now: string,
  options: { incrementCount?: boolean } = {}
): NotificationRecord {
  const incomingEventTypeId = incoming.eventTypeId
  const crossType = incomingEventTypeId !== undefined && incomingEventTypeId !== existing.eventTypeId
  const mergedEventTypes = crossType
    ? [...new Set([...(existing.mergedEventTypes ?? [existing.eventTypeId]), incomingEventTypeId])]
    : existing.mergedEventTypes
  return {
    ...existing,
    // 版次：**带了才覆盖成最新那次，没带就保持原样**——自动路径不带 edition，
    // 不能让它把记录里已有的版次抹掉（否则按钮又会判「版次不符」）。
    ...(incoming.edition === undefined ? {} : { edition: incoming.edition }),
    // 标题与动作取第一次：读者靠标题认人，动作一变等于换了一条通知。
    bodyKey: incoming.bodyKey ?? existing.bodyKey,
    bodyParams: incoming.bodyKey !== undefined ? incoming.bodyParams : existing.bodyParams,
    // 成品记录：**只换正文**，标题与理由保留既有（四条写法里的 1 与 3）。
    ...(incoming.rendered === undefined ? {} : { rendered: mergeRenderedBodies(existing.rendered, incoming.rendered) }),
    mergedEventTypes,
    severity: strongerSeverity(existing.severity, incoming.severity),
    priority: strongerPriority(existing.priority, incoming.priority),
    channels: uniqueChannels([...existing.channels, ...incoming.requestedChannels]),
    updatedAt: now,
    occurrenceCount:
      crossType || options.incrementCount === false ? existing.occurrenceCount : existing.occurrenceCount + 1,
    expiresAt: incoming.expiresAt ?? existing.expiresAt,
    safeMetadata: incoming.safeMetadata ?? existing.safeMetadata
  }
}

/**
 * 合并成品句子：**逐语言只覆盖正文**；这次没带正文的语言保持原样。
 *
 * 为什么不是整份替换：整份替换会把标题也换掉，而合并的第一条写法是「标题取第一次」——
 * 读者靠标题认人，标题一变等于换了一条通知。旧记录没有 `rendered` 时直接采用新的。
 */
function mergeRenderedBodies(
  existing: NotificationContentByLanguage | undefined,
  incoming: NotificationContentByLanguage
): NotificationContentByLanguage {
  if (existing === undefined) return incoming
  const merged: NotificationContentByLanguage = { ...existing }
  for (const language of ['zh-CN', 'en-US'] as const) {
    const next = incoming[language]
    if (next === undefined) continue
    const previous = existing[language]
    merged[language] = previous === undefined
      ? next
      : { title: previous.title, body: next.body, reason: previous.reason }
  }
  return merged
}

function strongerSeverity(left: NotificationSeverity, right: NotificationSeverity): NotificationSeverity {
  return SEVERITY_RANK[left] >= SEVERITY_RANK[right] ? left : right
}

function strongerPriority(left: NotificationPriority, right: NotificationPriority): NotificationPriority {
  return PRIORITY_RANK[left] >= PRIORITY_RANK[right] ? left : right
}

function uniqueChannels(channels: NotificationChannel[]): NotificationChannel[] {
  return [...new Set(channels)]
}
