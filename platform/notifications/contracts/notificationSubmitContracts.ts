/**
 * 提交这一侧的形状：去重键输入、提交请求、提交结果（契约 §3.2 / §4 / §16）。
 *
 * 从 `notificationContracts.ts` 抽出来的：那里已经顶到 500 行硬线，而这一段是完整概念——
 * 「怎么提交、提交回来什么」，与记录本身、设置、投递状态的形状是两件事。纯类型搬运，行为零改动。
 */
import type { NotificationApprovedLevel, NotificationRequestedLevel } from '../contracts/notificationEventCatalog'
import type { NotificationCopyParam } from './notificationCopyPort'
import type { NotificationSubmitRejection } from './notificationSubmitRejection'
import type {
  NotificationAction,
  NotificationContentByLanguage,
  NotificationDeeplink,
  NotificationDeliveryState,
  NotificationSeverity,
  NotificationSignalSeverity
} from './notificationContracts'

/** 去重键的输入（契约 §3.2）：判别联合，不是自由字符串表。 */
export type NotificationDedupeVars =
  /**
   * 日内：键 = 模块 + 规则 + 资产，**不带时间**（契约 v2.43 §7.4）。窗口由 `conditionWindowMs` 判。
   *
   * `observedAt` / `bucketMs` 已废弃：留着只是为了产品侧还没迁完的提交能编译。**运行时一律拒收**
   * （`stale-signal-dedupe-vars`）——静默忽略就等于「你以为冷却生效了、其实每个桶都算一件事」。
   * 产品侧改完那一天，这两个字段随之删除。
   */
  | { builder: 'moduleSignal'; moduleId: string; ruleId: string; asset: string | null
      cadence: 'intraday'
      /** @deprecated 日内键不带时间；传了会被拒收。 */
      observedAt?: string
      /** @deprecated 同上。 */
      bucketMs?: number }
  /** 交易日：键里带交易日（由 `observedAt` 折成日期），一天一条天然成立。 */
  | { builder: 'moduleSignal'; moduleId: string; ruleId: string; asset: string | null
      observedAt: string; cadence: 'trading-day' }
  | { builder: 'sourceIssue'; sourceId: string }
  | { builder: 'template'; vars: Readonly<Record<string, string>> }

/** 提交请求（契约 §3.2）：记录里存键与参数，不存句子。 */
export type NotificationSubmitRequest = {
  eventTypeId: string
  /**
   * 去重键命名空间（技术方案 §2）：只允许 `'test'` 一个值，规划器把键拼成 `test:<product>|<原键>`。
   *
   * **不是** `dedupeKeyOverride`：那不是命名空间，而是让调用方直接写键——真实去重键会不会被占上，
   * 就全凭调用方自觉了，而这正是「测试不吃真实通知」要防的。这里只有「同一个键、不同域」一件事。
   */
  namespace?: 'test'
  /**
   * **按次收窄**要发的表面（一次提交一个值，不落进读者配置）。
   *
   * 四条语义：
   * 1. **只能收窄**：结果 = 批准档 ∩ 这个数组，任何情况下不超出批准表；
   * 2. **`center` 不可排除**：中心是平台必达，数组里没有它也照样保留；
   * 3. **合并不许升级**：只影响本次提交，不改记录已有的最高档；
   * 4. **缺省同今天**：不传＝完全按批准表。
   */
  narrowedDisruptionLevels?: readonly NotificationApprovedLevel[]
  producerId?: string
  /**
   * 只记录不投递（契约 §16.3.3）：照常走提交与去重，但**不写任何表面的 delivery 条目**。
   * 缺省 `true`（不传＝投递，历史调用方一行不用改）。**只许手动/读者动作路径用**，
   * 自动生产者带上它由生产者边界守卫报错。
   */
  deliver?: boolean
  /** 读者眼前那一版；落库供 `redeliverPush` 核对。 */
  edition?: { editionId: string; locale: string }
  dedupeVars: NotificationDedupeVars
  /**
   * 记录上的**展示严重度**（`NotificationSeverity`）。以前提交计划器把它写死成 `info`，
   * 于是每一行的严重度都是常量——生产者传了也没用。缺省 `info` 只为历史调用方。
   */
  severity?: NotificationSeverity
  /**
   * 这次提交的**信号严重度**（契约 v2.45）：只参与 `condition` 事件的「升级再投递」判断。
   * 与 `severity` 是两个概念，不许互相顶替。不传＝这次不声明档位，也就不触发升级。
   */
  signalSeverity?: NotificationSignalSeverity
  /**
   * 源头拼好的成品句子（契约 v2.56）。给了它，平台**不再碰文案表**；
   * 三段缺语言或某段空串 → `rejected: copy-missing`，不落库。
   */
  rendered?: NotificationContentByLanguage
  titleParams?: Readonly<Record<string, NotificationCopyParam>>
  bodyParams?: Readonly<Record<string, NotificationCopyParam>>
  bodyVariant?: string
  /** 标题/理由的变体名（与 `bodyVariant` 同形）：事件声明了变体表就必须给，否则拒收。 */
  titleVariant?: string
  reasonVariant?: string
  reasonParams?: Readonly<Record<string, NotificationCopyParam>>
  actions: readonly NotificationAction[]
  deeplink?: NotificationDeeplink
  correlationId?: string
  occurredAt: string
}

/** 给产品的回执（契约 §6.1 封闭集合）；不向用户抛异常。 */
/**
 * 这次提交里**没有被尝试**的表面，以及为什么。回执据此说「没测」而不是「没到」：
 * 前者是读者的开关或免打扰把这一档挡在门外（根本没试），后者是试了但失败。
 */
export type NotificationSuppressedLevel = {
  level: 'toast' | 'popup' | 'desktop' | 'push'
  reason: 'quiet-hours' | 'toast-disabled' | 'popup-disabled' | 'desktop-disabled'
}

/**
 * 这一次提交**真实产生**的投递证据：哪些表面、什么状态（四档照抄记录上的词）。
 *
 * 只有「这次真的试过」才有：`merged` 里旧记录的投递是历史，不是这次的结果，所以不带；
 * 严重度升级那次例外——它确实又推了一次手机，带且只带 `push`。
 */
export type NotificationSubmitDelivery = Partial<
  Record<'toast' | 'popup' | 'desktop' | 'push', NotificationDeliveryState>
>

export type NotificationSubmitOutcome =
  | {
      kind: 'accepted'
      recordId: string
      levels: readonly NotificationApprovedLevel[]
      /** 没被尝试的表面（免打扰 / 开关关着）。空数组＝每一档都真的试了。 */
      suppressedLevels: readonly NotificationSuppressedLevel[]
      /** 这条记录这一次的投递证据（与记录同源，不从别处反推）。 */
      delivery?: NotificationSubmitDelivery
    }
  | {
      kind: 'merged'
      recordId: string
      occurrenceCount: number
      mergedEventTypes: string[]
      /** **只有真发生了严重度升级**才带：那一次确实又推了手机；普通合并不带（旧投递是历史）。 */
      delivery?: NotificationSubmitDelivery
    }
  | { kind: 'collapsed'; aggregateRecordId: string; collapsedCount: number }
  /** 让渡给了产品：平台不落库、不投递，只记一条 `delegated` 诊断（契约 §14）。 */
  | { kind: 'delegated'; eventTypeId: string; producerId: string; ownerProductId: string }
  | NotificationSubmitRejection

