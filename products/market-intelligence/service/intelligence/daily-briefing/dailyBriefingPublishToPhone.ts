import type { NotificationDeliveryState } from '@platform/notifications/contracts/notificationContracts'
import type { DailyBriefingStore } from './dailyBriefingService'
import type { RedeliverReasonCode } from '@platform/notifications/runtime/notificationRedeliver'
import type { DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import type { DailyBriefingNoticeSubmit } from './dailyBriefingNotifier'
import { notifyDailyBriefing } from './dailyBriefingNotifier'

/**
 * 「把眼前这一版发布到手机」：**先把这一版写进通知记录，再推那一条**。
 *
 * 顺序不是实现细节，是读者语义（2026-11-05）：按钮说的是「发布这一版」，不是「去库里找一条
 * 已经存在的记录」。所以库里没有当天记录时，先提交一次只记不发的完成事件（`deliver: false`，
 * 幂等合并），再按同一个键重投。这样 `redeliver-target-missing` 这一类就不该再出现；
 * 剩下的 `redeliver-edition-mismatch` 只可能是真实竞态（别人先跑了另一版）。
 *
 * 记录不存在时**不提交、不推**：给一份不存在的版次写「已完成」是假话，按钮该落
 * 「这一版还没生成」。
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
  redeliver: ((input: Readonly<{ dedupeKey: string; editionId: string; locale: string }>) => Promise<
    | Readonly<{ kind: 'accepted'; recordId: string; delivery: NotificationDeliveryState }>
    | Readonly<{ kind: 'rejected'; reason: RedeliverReasonCode }>
  >) | undefined
  now: () => string
}>

/**
 * 完成记录的键：日期 + 期号 + 语言（与声明、与页面同一个公式），三种身份缺一不可。
 *
 * 注意：`redeliverPush` 比对的是**落库后的键**，平台在落库时加上了 `产品id|` 前缀
 * （`notificationSubmitPlan` 里那一处）。所以这里传的是带前缀的完整键——不是模板里的原始串。
 */
export function briefingPushDedupeKey(input: Readonly<{ date: string; periodId: string; locale: string }>): string {
  return `briefing-ready:${input.date}:${input.periodId}:${input.locale}`
}

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
  // 先写/更新记录（deliver: false）：库里已有当天记录时这一步是合并，不会多一行。
  await notifyDailyBriefing(deps.submit, {
    kind: 'ready', date: input.date, periodId: input.periodId, editionId, locale: input.locale, deliver: false
  }, deps.now())
  // `redeliverPush` 找的是**记录上那个键**：平台落库时加了 `market-intelligence|` 前缀，原样比对。
  return deps.redeliver({ dedupeKey: `market-intelligence|${briefingPushDedupeKey(input)}`, editionId, locale: input.locale })
}
