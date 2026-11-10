import { isAcceptedCredentialSave } from '../../shared/intelligenceCredentialResultPolicy'
import { intelligenceSourcesClient } from '../../shared/ipc/intelligenceSourcesClient'
import type { IntelligenceSourceProfile } from '../../../service/intelligence/schema/intelligenceSource'

/**
 * 情报源设置页的纯帮手：保存入参、列表合并、通知句子、超时与轮询。
 *
 * 从 `useIntelligenceSourcesSettings` 抽出来的唯一理由是把那个 hook 压回 500 行以内（体积门禁
 * 对新文件是硬上限）；这里没有状态、没有 React，行为与原来逐字一致。
 */

/** 保存凭证的结果是否属于「已存上」——只认这一种，其余都按没存上处理。 */
export function isSuccessfulCredentialOperation(value: unknown, sourceId: string): boolean {
  return isAcceptedCredentialSave(value, sourceId)
}

/** 采集任务刚提交时健康数据往往还没到：有界地等它给出结果，等不到就再读一次当前值。 */
export function waitForRunHealth(sourceId: string) {
  return pollRunHealth(sourceId)
}

async function pollRunHealth(sourceId: string) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const health = await intelligenceSourcesClient.getHealth(sourceId)
    if (health.lastSuccessAt || health.lastFailureAt || health.lastRunSummary) {
      return health
    }
    await sleep(500)
  }
  return intelligenceSourcesClient.getHealth(sourceId)
}

/** 改完启用状态要说哪一句：手动档不自动拉取，与自动采集的提示不是同一件事。 */
export function resolveEnabledNotice(
  profile: IntelligenceSourceProfile,
  enabled: boolean,
  labels: {
    saved: string
    disabledSaved: string
    enabledManualHint: string
    enabledAutoCollectQueued: string
  }
): string {
  if (!enabled) return labels.disabledSaved
  if (profile.collectionPreset === 'manual') return labels.enabledManualHint
  return labels.enabledAutoCollectQueued
}

/** 一次「立即运行」的结果：成功了 / 这次没成 / 提交了但还没拿到结果。 */
export type SourceRunOutcome = Readonly<{
  kind: 'succeeded' | 'failed' | 'unknown'
  /** 给读者看的那一句（成功带摘要，失败带原因，拿不到结果时如实说还在等）。 */
  notice: string
}>

/** 健康读数 → 一次运行的结果。判据与 `resolveRunNotice` 同一份，避免句子与状态互相打架。 */
export function runOutcomeOf(
  health: Awaited<ReturnType<typeof intelligenceSourcesClient.getHealth>>,
  labels: { runQueued: string; runSucceeded: string; runFailed: string }
): SourceRunOutcome {
  const notice = resolveRunNotice(health, labels)
  if (health.lastFailureAt && (!health.lastSuccessAt || health.lastFailureAt >= health.lastSuccessAt)) {
    return { kind: 'failed', notice }
  }
  if (health.lastSuccessAt) return { kind: 'succeeded', notice }
  return { kind: 'unknown', notice }
}

/** 跑一次之后要说哪一句：失败优先，成功带摘要，没有任何结果时是「已排队」。 */
export function resolveRunNotice(
  health: Awaited<ReturnType<typeof intelligenceSourcesClient.getHealth>>,
  labels: { runQueued: string; runSucceeded: string; runFailed: string }
): string {
  if (health.lastFailureAt && (!health.lastSuccessAt || health.lastFailureAt >= health.lastSuccessAt)) {
    return health.lastRunSummary ? `${labels.runFailed} ${health.lastRunSummary}` : labels.runFailed
  }
  if (health.lastSuccessAt) {
    return health.lastRunSummary ? `${labels.runSucceeded} ${health.lastRunSummary}` : labels.runSucceeded
  }
  return labels.runQueued
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    sleep(ms).then(() => {
      throw new Error('Save timed out.')
    })
  ])
}

/**
 * 保存只带这几项：profileId / updatedAt 由服务端决定，不能由界面回写。
 *
 * **`enabled` 不在里面**：启用状态只由行尾那颗开关写（`setEnabled` / `setCalendarEnabled`）。
 * 页面持有的 profile 是进入这一屏时的快照，读者拨过开关之后它就是过期的；整份回写会把旧值
 * 盖回磁盘（读者会看到「改了个采集预设，启用又自己变了」）。服务端按「没传就保持」合并。
 */
export function toSaveProfileInput(profile: IntelligenceSourceProfile) {
  return {
    sourceId: profile.sourceId,
    collectionPreset: profile.collectionPreset,
    includeInSentiment: profile.includeInSentiment,
    scopePolicy: profile.scopePolicy,
    rawArchiveEnabled: profile.rawArchiveEnabled,
    retentionMode: profile.retentionMode,
    autoReplayAfterParserUpgrade: profile.autoReplayAfterParserUpgrade,
    credentialRef: profile.credentialRef
  }
}

/** 同一 sourceId 只留一行：新值替换旧值，没有就追加。 */
export function upsertProfile(
  profiles: IntelligenceSourceProfile[],
  profile: IntelligenceSourceProfile
): IntelligenceSourceProfile[] {
  const index = profiles.findIndex((item) => item.sourceId === profile.sourceId)
  if (index < 0) return [...profiles, profile]
  return profiles.map((item, itemIndex) => (itemIndex === index ? profile : item))
}
