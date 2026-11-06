/**
 * runtime 的投递面（契约 §16.3 / 通道方案 §2.2）：把一条**首次提交**的记录投出去，并把每个
 * 表面的证据写回同一条记录。合并/重复提交不重推——这一步只被 `submit()` 的新记录分支调用一次。
 *
 * 文案在这里解析一次，四个钩子拿同一份 `content`；端口不再解析、不再拼时刻。
 */
import {
  notificationCopyText,
  resolveNotificationCopyText,
  type NotificationCopyLanguage
} from '../../i18n/notificationCopy'
import type { NotificationCopyParam, NotificationCopyPort } from '../contracts/notificationCopyPort'
import { SIGNAL_SEVERITY_RANK } from '../contracts/notificationContracts'
import type {
  NotificationAction,
  NotificationDiagnosticsSink,
  NotificationSignalSeverity,
  NotificationPushBackoff,
  NotificationRecord,
  NotificationRuntimeSettings
} from '../contracts/notificationContracts'
import { recordPushOutcome, shouldSkipPush, type PushDeliveryOutcome } from '../delivery/pushBackoffPolicy'
import {
  routeTransientDelivery,
  type DeliveryHooks,
  type NotificationClock,
  type NotificationDeliveryContent
} from './notificationRouting'

export type NotificationPushTransition = { kind: 'paused' | 'resumed'; channelId: string }

export type NotificationDeliveryInput = {
  deliveryHooks?: DeliveryHooks
  clock: NotificationClock
  getLanguage?: () => Promise<'zh-CN' | 'en-US'>
  copy?: NotificationCopyPort
  diagnostics?: NotificationDiagnosticsSink
  now: () => string
}

export function createNotificationDelivery(input: NotificationDeliveryInput) {
  /**
   * 已经报过「这条解析不出来」的记录：**一条记录只报一次**。
   * 每条记录每次读都会解析一次（切语言、翻页都会再读），不去重的话，打开一次中心就写进几十条同样的诊断，
   * 真正「第一次坏掉」的那一刻反而被淹掉。
   */
  const reportedUnresolved = new Set<string>()
  /**
   * 一条记录的文案，**在读者读到的那一刻**按当前语言解析一次（契约 §3.3）。
   *
   * 解析不到时**整条降级**：标题换成定稿兜底句、正文清空——不显示半句，也不拿键顶上。
   * 同时留一条 `copy-unresolved` 诊断（键 + 记录 id），它只进日志与开发工具、不进界面。
   *
   * `language` 可由调用方一次取好传进来（列表要解析一整页，不该每条读一次设置）。
   */
  async function resolveContent(
    record: NotificationRecord,
    language?: NotificationCopyLanguage
  ): Promise<NotificationDeliveryContent> {
    const resolvedLanguage = language ?? (await input.getLanguage?.()) ?? 'zh-CN'
    const fallback = notificationCopyText(resolvedLanguage, 'notification.fallback.title')
    let unresolvedKey: string | undefined
    const resolve = (
      key: NotificationRecord['titleKey'] | undefined,
      params: Readonly<Record<string, NotificationCopyParam>> | undefined
    ): string | null => {
      if (key === undefined) return ''
      const ref = record.productId === undefined
        ? { scope: 'platform' as const, key, ...(params === undefined ? {} : { params }) }
        : { scope: 'product' as const, productId: record.productId, key, ...(params === undefined ? {} : { params }) }
      const resolved = input.copy?.resolve(ref, resolvedLanguage)
      if (typeof resolved === 'string' && resolved.length > 0) return resolved
      // 没有端口、或端口解析不到时，退回平台闭集（产品键本来就不在闭集里，会落到兜底句）。
      const text = notificationCopyText(resolvedLanguage, key)
      const literals = onlyLiteralParams(params)
      if (typeof text !== 'string' || text.length === 0 || literals === null) {
        unresolvedKey = key
        return null
      }
      // 参数缺失时不许把 `{taskName}` 印到读者面前：回退兜底句。
      const filled = resolveNotificationCopyText(resolvedLanguage, text, literals)
      if (/\{\w+\}/.test(filled)) {
        unresolvedKey = key
        return null
      }
      return filled
    }

    // 注意：可选段（`{taskName?}`）被丢掉时句子照常出，**目前不留诊断**——它不算解析失败。
    // 代价是「为什么这一段少了」只能从记录参数看出来；要追因果时先看这条注释。
    const title = resolve(record.titleKey, record.titleParams)
    const body = resolve(record.bodyKey, record.bodyParams)
    const reason = resolve(record.reasonKey, record.reasonParams)
    if (title === null && !reportedUnresolved.has(record.id)) {
      reportedUnresolved.add(record.id)
      input.diagnostics?.({
        code: 'copy-unresolved',
        at: input.now(),
        recordId: record.id,
        eventTypeId: record.eventTypeId,
        key: unresolvedKey ?? record.titleKey,
        language: resolvedLanguage
      })
    }
    // 「共 N 次」只在真的合并过时解析：单条记录不出现这句，否则读者会以为还有一条他没看到的。
    const occurrenceLabel = record.occurrenceCount > 1
      ? resolve('notification.occurrenceCount', { count: String(record.occurrenceCount) })
      : null
    return {
      // 整条降级：标题没有可用句子时，正文也不许留半句。
      title: title ?? fallback,
      body: title === null ? '' : (body ?? ''),
      reason: title === null ? '' : (reason ?? ''),
      // 动作**不跟着文案走**：它是一条结构事实（点开去哪），文案缺了也不许把入口一起吞掉。
      actionLabels: resolveActionLabels(record.actions, resolvedLanguage),
      ...(occurrenceLabel === null ? {} : { occurrenceLabel }),
      ...(record.deeplink === undefined ? {} : { deeplink: record.deeplink })
    }

    /**
     * 动作标签和正文用**同一次**语言、同一张表解析。解析不出来就整条不给（`null`）：
     * 一个按不动的按钮比没有按钮更糟，而拿 `labelKey` 顶上去正是今晚要灭的那种露键。
     */
    function resolveActionLabels(
      actions: readonly NotificationAction[],
      language: NotificationCopyLanguage
    ): Readonly<Record<string, string>> {
      const labels: Record<string, string> = {}
      for (const action of actions) {
        const text = notificationCopyText(language, action.labelKey)
        if (typeof text !== 'string' || text.length === 0) continue
        labels[action.id] = text
      }
      return labels
    }
  }

  /**
   * 只在这一步投递一次（契约 §16.3「合并不重推」）。跳过不算失败：该表面不写 delivery 条目；
   * `unknown-after-send` 是独立原因码，不能写成「没发到手机」。
   */
  async function deliverNewRecord(
    record: NotificationRecord,
    settings: NotificationRuntimeSettings,
    pushBackoff: Readonly<Record<string, NotificationPushBackoff>>,
    /** 这次提交声明的信号严重度：首次推送成功时记进 `delivery.push.highestSeverity`。 */
    signalSeverity?: NotificationSignalSeverity
  ): Promise<{
    record: NotificationRecord
    pushBackoff: Readonly<Record<string, NotificationPushBackoff>>
    /** 桌面这一跳没弹出来（`show()` 返回 `ok:false` 或平台不支持）：P7 的唯一来源。 */
    desktopBlocked: boolean
    transition?: NotificationPushTransition
  }> {
    const content = await resolveContent(record)
    const attempts = await routeTransientDelivery(record, settings, input.deliveryHooks ?? {}, input.clock, content)
    const delivery: NotificationRecord['delivery'] = { ...record.delivery }
    let desktopBlocked = false
    for (const attempt of attempts) {
      if (attempt.channel !== 'toast' && attempt.channel !== 'popup' && attempt.channel !== 'desktop') continue
      if (attempt.result === 'skipped') {
        delete delivery[attempt.channel]
        continue
      }
      // 只认「真的试过但没成」：开关关着（skipped/desktop-disabled）是读者的选择，不算被拦下。
      if (attempt.channel === 'desktop' && attempt.result === 'failed') desktopBlocked = true
      delivery[attempt.channel] = {
        state: attempt.result === 'failed' ? 'failed' : 'sent-accepted',
        at: attempt.attemptedAt,
        ...(attempt.reason === undefined ? {} : { reason: attempt.reason })
      }
    }

    const pushOutcome = delivery.push?.state === 'queued'
      ? await attemptPush(record, delivery, settings, pushBackoff, content, signalSeverity)
      : undefined
    const deliveryChanged = JSON.stringify(delivery) !== JSON.stringify(record.delivery)
    return {
      record: deliveryChanged ? { ...record, delivery } : record,
      pushBackoff: pushOutcome?.pushBackoff ?? pushBackoff,
      desktopBlocked,
      ...(pushOutcome?.transition === undefined ? {} : { transition: pushOutcome.transition })
    }
  }

  /**
   * 手机这一档的一次投递（契约 §8/§16.3.4）：唯一写 `delivery.push` 的地方。
   *
   * `highestSeverity` 只在这里、且只在**真的发出去了**（受理或未确认）时抬——推失败不算「已经告诉过读者」。
   * 比较用 `SIGNAL_SEVERITY_RANK`，跟展示用的 `NotificationSeverity` 不是一回事。
   */
  async function attemptPush(
    record: NotificationRecord,
    delivery: NotificationRecord['delivery'],
    settings: NotificationRuntimeSettings,
    pushBackoff: Readonly<Record<string, NotificationPushBackoff>>,
    content: NotificationDeliveryContent,
    signalSeverity: NotificationSignalSeverity | undefined
  ): Promise<{
    pushBackoff: Readonly<Record<string, NotificationPushBackoff>>
    transition?: NotificationPushTransition
  }> {
    const nextBackoff: Record<string, NotificationPushBackoff> = { ...pushBackoff }
    let changed = false
    let transition: NotificationPushTransition | undefined
    const at = input.now()
    const channelId = settings.push.channelId
    const current = channelId === null ? undefined : pushBackoff[channelId]
    const previousHighest = delivery.push?.highestSeverity
    const highest = (sent: boolean): NotificationSignalSeverity | undefined => {
      if (!sent || signalSeverity === undefined) return previousHighest
      if (previousHighest === undefined) return signalSeverity
      return SIGNAL_SEVERITY_RANK[signalSeverity] > SIGNAL_SEVERITY_RANK[previousHighest]
        ? signalSeverity
        : previousHighest
    }

    if (channelId === null || !input.deliveryHooks?.push) {
      delivery.push = { state: 'failed', reason: 'push-unavailable', at, ...(previousHighest === undefined ? {} : { highestSeverity: previousHighest }) }
      return { pushBackoff }
    }
    if (shouldSkipPush(current, at)) {
      // 熔断窗口内不发：写独立原因码，不调用端口（通道方案 §3）。
      delivery.push = { state: 'failed', reason: 'push-backoff', at, ...(previousHighest === undefined ? {} : { highestSeverity: previousHighest }) }
      return { pushBackoff }
    }

    const result = await input.deliveryHooks.push({ ...record, delivery }, content)
    const outcome: PushDeliveryOutcome = result.ok
      ? 'sent-accepted'
      : result.reason === 'unknown-after-send'
        ? 'unknown-after-send'
        : 'failed'
    const decision = recordPushOutcome(current, outcome, at)
    // `unknown-after-send` 与「本来就没失败过」返回原值：不写，保留「没有熔断记录」这个状态。
    if (decision.changed) {
      nextBackoff[channelId] = {
        channelId,
        failures: decision.failures,
        pausedUntil: decision.pausedUntil
      }
      changed = true
    }
    if (decision.transition === 'suspended') transition = { kind: 'paused', channelId }
    if (decision.transition === 'resumed') transition = { kind: 'resumed', channelId }
    const sent = outcome !== 'failed'
    const nextHighest = highest(sent)
    delivery.push = result.ok
      ? {
          state: 'sent-accepted',
          at,
          ...(result.messageId === undefined ? {} : { messageId: result.messageId }),
          ...(nextHighest === undefined ? {} : { highestSeverity: nextHighest })
        }
      : {
          state: 'failed',
          reason: result.reason ?? 'channel-rejected',
          at,
          ...(nextHighest === undefined ? {} : { highestSeverity: nextHighest })
        }
    return { pushBackoff: changed ? nextBackoff : pushBackoff, ...(transition === undefined ? {} : { transition }) }
  }

  /**
   * 严重度升级后的再投递（契约 v2.45 §16.3.4）：**只推手机这一面**，不新建行、不动键。
   *
   * 与 `redeliverPush` 是两条入口，互不调用：那条是读者点出来的，这条是自动路径上「这件事更严重了」。
   * 哨兵：只有调用方已经判定「严格升级」，这里不做第二次判断。
   */
  async function deliverSeverityUpgrade(
    record: NotificationRecord,
    settings: NotificationRuntimeSettings,
    pushBackoff: Readonly<Record<string, NotificationPushBackoff>>,
    severity: NotificationSignalSeverity
  ): Promise<{
    record: NotificationRecord
    pushBackoff: Readonly<Record<string, NotificationPushBackoff>>
    transition?: NotificationPushTransition
  }> {
    const content = await resolveContent(record)
    const delivery: NotificationRecord['delivery'] = { ...record.delivery }
    const outcome = await attemptPush(record, delivery, settings, pushBackoff, content, severity)
    return { record: { ...record, delivery }, pushBackoff: outcome.pushBackoff, ...(outcome.transition === undefined ? {} : { transition: outcome.transition }) }
  }

  return { resolveContent, deliverNewRecord, deliverSeverityUpgrade }
}

export type NotificationDeliverySurface = ReturnType<typeof createNotificationDelivery>

/**
 * 平台闭集兜底只认字面量：参数里只要有一个 `{ ref }`，这条就必须走端口解析；
 * 端口不在（或解析不到）就算解析不到——整条降级，绝不把没展开的引用印给读者。
 */
function onlyLiteralParams(
  params: Readonly<Record<string, NotificationCopyParam>> | undefined
): Record<string, string> | null {
  if (params === undefined) return {}
  const literals: Record<string, string> = {}
  for (const [key, value] of Object.entries(params)) {
    if (typeof value !== 'string') return null
    literals[key] = value
  }
  return literals
}
