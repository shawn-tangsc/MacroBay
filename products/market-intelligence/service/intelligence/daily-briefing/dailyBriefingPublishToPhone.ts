import type { NotificationDeliveryState } from '@platform/notifications/contracts/notificationContracts'
import type { DailyBriefingStore } from './dailyBriefingService'
import type { RedeliverReasonCode } from '@platform/notifications/runtime/notificationRedeliver'
import type { DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import type { DailyBriefingNoticeSubmit } from './dailyBriefingNotifier'
import { notifyDailyBriefing } from './dailyBriefingNotifier'

/**
 * 「把眼前这一版发布到手机」：**先把这一版写进通知记录，再用回执里的记录身份推那一条**。
 *
 * 顺序不是实现细节，是读者语义（2026-11-05）：按钮说的是「发布这一版」，不是「去库里找一条
 * 已经存在的记录」。所以库里没有记录时，先提交一次只记不发的完成事件（`deliver: false`，
 * 幂等合并），再拿**提交回执里的 `recordId`** 重投（契约 v2.32）。
 *
 * 键不在这里出现：模板串、产品前缀、分隔符、展开时机全归平台的声明与落库一处。产品手拼过一次，
 * 就是「看着英文版推成中文版」那类事故的来源（前缀拼错时平台只会说「记录不存在」）。
 *
 * 记录不存在时**不提交、不推**：给一份不存在的版次写「已完成」是假话，按钮该落
 * 「这一版还没生成」。提交拿不到回执（端口未装配、被拒、被折叠）时也不推——否则又是一次
 * 「以为推了」。
 */

export type BriefingPublishOutcome =
  | Readonly<{ kind: 'accepted'; recordId: string; delivery: NotificationDeliveryState }>
  | Readonly<{ kind: 'rejected'; reason: 'edition-missing' | 'runtime-unavailable' | RedeliverReasonCode }>

export type BriefingPublishDeps = Readonly<{
  /** 这一版是否真的在库里（只读；不存在就不该发布）。 */
  hasEdition: (input: Readonly<{ date: string; locale: DailyBriefingLocale; periodId: string }>) => Promise<boolean>
  /** 通知提交端口；未装配时无法先写记录。 */
  submit: DailyBriefingNoticeSubmit | undefined
  /** 平台「把这条已有记录再推一次手机」的入口；未装配时按钮落 runtime-unavailable。 */
  redeliver: ((input: Readonly<{ recordId: string; editionId: string; locale: string }>) => Promise<
    | Readonly<{ kind: 'accepted'; recordId: string; delivery: NotificationDeliveryState }>
    | Readonly<{ kind: 'rejected'; reason: RedeliverReasonCode }>
  >) | undefined
  now: () => string
}>

/** 记录里存的那一版身份；与页面上的 `editionId` 同一公式，平台拿它核对。 */
export function briefingPushEditionId(input: Readonly<{ date: string; locale: string; periodId: string }>): string {
  return `${input.date}:${input.locale}:${input.periodId}`
}

/** 平台重投入口的形状；服务层只透传，不自己拼结果。 */
export type BriefingRedeliver = NonNullable<BriefingPublishDeps['redeliver']>

/**
 * 服务侧只需要这一个入口：把存储、通知端口与时钟交给它，拿回 `publishToPhone` 方法。
 * 抽成工厂是为了让服务在体积门上不再加长——那里已经有 200 行生成流程，不该再多一段搬运。
 */
export function createPublishToPhone(deps: Readonly<{
  store: Pick<DailyBriefingStore, 'get'>
  submit: DailyBriefingNoticeSubmit | undefined
  redeliver: BriefingRedeliver | undefined
  now: () => string
}>): (input: Readonly<{ date: string; locale: DailyBriefingLocale; periodId: string }>) => Promise<BriefingPublishOutcome> {
  return (input) => publishBriefingToPhone({
    hasEdition: async (edition) => (await deps.store.get(edition.date, edition.locale, edition.periodId)) !== undefined,
    submit: deps.submit,
    redeliver: deps.redeliver,
    now: deps.now
  }, input)
}

export async function publishBriefingToPhone(
  deps: BriefingPublishDeps,
  input: Readonly<{ date: string; locale: DailyBriefingLocale; periodId: string }>
): Promise<BriefingPublishOutcome> {
  const exists = await deps.hasEdition(input).catch(() => false)
  if (!exists) return { kind: 'rejected', reason: 'edition-missing' }
  if (deps.redeliver === undefined) return { kind: 'rejected', reason: 'runtime-unavailable' }
  const editionId = briefingPushEditionId(input)
  // 先写/更新记录（deliver: false）：库里已有这一版的记录时这一步是合并，不会多一行。
  const receipt = await notifyDailyBriefing(deps.submit, {
    kind: 'ready', date: input.date, periodId: input.periodId, editionId, locale: input.locale, deliver: false
  }, deps.now())
  // 推的是**回执里那条记录**，不是自己拼出来的键：没有回执就没有可推的东西，不许假装推了。
  if (receipt === null || receipt.kind === 'rejected' || receipt.kind === 'delegated' || receipt.kind === 'collapsed') {
    return { kind: 'rejected', reason: 'runtime-unavailable' }
  }
  return deps.redeliver({ recordId: receipt.recordId, editionId, locale: input.locale })
}
