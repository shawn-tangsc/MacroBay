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
import { findActionDirective } from '../contracts/actionDirective'
import type { NotificationCopyParam, NotificationCopyPort, NotificationCopyRef } from '../contracts/notificationCopyPort'
import { SIGNAL_SEVERITY_RANK } from '../contracts/notificationContracts'
import type {
  NotificationAction,
  NotificationDiagnosticsSink,
  NotificationSuppressedLevel,
  NotificationSignalSeverity,
  NotificationPushBackoff,
  NotificationRecord,
  NotificationRuntimeSettings
} from '../contracts/notificationContracts'
import { recordPushOutcome, shouldSkipPush, type PushDeliveryOutcome } from '../delivery/pushBackoffPolicy'
import type { PushChannelResolution } from '../delivery/pushChannelResolution'
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
  /** 目标通道的唯一派生（技术方案 §1）；缺省视为「一条都没有」，绝不回退去读旧字段。 */
  resolvePushChannel?: () => Promise<PushChannelResolution>
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

    // 新形状（契约 v2.56）：源头已拼好成品，平台**只挑一份、只拦不改**。
    if (record.rendered !== undefined) {
      return renderedContent(record, resolvedLanguage, fallback)
    }
    let unresolvedKey: string | undefined
    const resolve = (
      key: NotificationRecord['titleKey'] | undefined,
      params: Readonly<Record<string, NotificationCopyParam>> | undefined
    ): string | null => {
      if (key === undefined) return ''
      const ref = record.productId === undefined
        ? { scope: 'platform' as const, key, ...(params === undefined ? {} : { params }) }
        : { scope: 'product' as const, productId: record.productId, key, ...(params === undefined ? {} : { params }) }
      const detailed = input.copy?.resolveDetailed?.(ref, resolvedLanguage)
      const resolved = detailed === undefined ? input.copy?.resolve(ref, resolvedLanguage) : detailed.text
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

    // 老形状（键+参数）：可选段/参数被丢掉时句子照常出。`copy-param-missing` 已随源头拼装退役
    // （契约 v2.56）——源头拼完，平台手里不再有「缺哪一格」这件事。
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
      actionLabels: resolveActionLabels(record, resolvedLanguage),
      ...(occurrenceLabel === null ? {} : { occurrenceLabel }),
      ...(record.deeplink === undefined ? {} : { deeplink: record.deeplink })
    }

    /**
     * 成品挑选（契约 v2.56 + Chief 2026-11-06 拍定的三条顺序）：
     * ① 记录上有 `edition.locale` 且那一份在 → **用它**（中心与手机同一份，否则同一条通知两处说两种语言）；
     * ② 否则用读者当前语言那一份；
     * ③ 都没有 → 兜底句 + `copy-unresolved`，**不许拿另一种顶上**（顶上就是语言对不上）。
     *
     * 拿到之后**只拦不改**：裸键、花括号占位、内部 id、指向本条通知的动作词 → 整条按不可发处理。
     * 「改成人话或删词」是替源头说话，越界（契约 §3.3 v2.55）。
     */
    function renderedContent(
      record: NotificationRecord,
      language: NotificationCopyLanguage,
      fallbackTitle: string
    ): NotificationDeliveryContent {
      const editionLanguage = record.edition?.locale
      const order: NotificationCopyLanguage[] = []
      if (editionLanguage === 'zh-CN' || editionLanguage === 'en-US') order.push(editionLanguage)
      if (!order.includes(language)) order.push(language)
      const picked = order.map((candidate) => record.rendered?.[candidate]).find((entry) => entry !== undefined)

      const blocked = picked !== undefined && [
        picked.title, picked.body, picked.reason
      ].some((text) => looksUnsendable(text))
      if (picked === undefined || blocked) {
        if (!reportedUnresolved.has(record.id)) {
          reportedUnresolved.add(record.id)
          input.diagnostics?.({
            code: 'copy-unresolved',
            at: input.now(),
            recordId: record.id,
            eventTypeId: record.eventTypeId,
            language
          })
        }
        return {
          title: fallbackTitle,
          body: '',
          reason: '',
          actionLabels: resolveActionLabels(record, language),
          ...(record.deeplink === undefined ? {} : { deeplink: record.deeplink })
        }
      }
      return {
        title: picked.title,
        body: picked.body,
        reason: picked.reason,
        actionLabels: resolveActionLabels(record, language),
        ...(record.deeplink === undefined ? {} : { deeplink: record.deeplink })
      }
    }

    /**
     * 动作标签和正文用**同一次**语言、同一条解析链路（v2.58）：引用优先（产品动作只有引用），
     * 老记录只有 `labelKey` 时按平台闭集读。
     *
     * 解析不出来就**不给这条动作**（渲染层没有标签就不画按钮）：一个按不动的按钮比没有按钮更糟，
     * 而拿键顶上去正是今晚要灭的那种露键。同时留一条 `action-label-unresolved`——按钮凭空消失
     * 而没有任何线索，是这次一定要堵掉的那种静默。
     */
    function resolveActionLabels(
      record: NotificationRecord,
      language: NotificationCopyLanguage
    ): Readonly<Record<string, string>> {
      const labels: Record<string, string> = {}
      for (const action of record.actions) {
        const ref = action.labelRef
          ?? (action.labelKey === undefined ? undefined : { scope: 'platform' as const, key: action.labelKey })
        const text = ref === undefined
          ? null
          : input.copy === undefined
            // 没有文案端口（未装配/单测）：只有平台键还读得出来，产品键照实报「解析不到」。
            ? (action.labelRef === undefined && action.labelKey !== undefined
                ? notificationCopyText(language, action.labelKey)
                : null)
            : input.copy.resolve(ref, language)
        if (typeof text !== 'string' || text.length === 0) {
          reportActionLabelUnresolved(record, action.id, ref, language)
          continue
        }
        labels[action.id] = text
      }
      return labels
    }

    /** 一条动作标签解析不到只报**一次**：切语言、翻页都会再解析，不去重会把真正的第一次淹掉。 */
    function reportActionLabelUnresolved(
      record: NotificationRecord,
      actionId: string,
      ref: NotificationCopyRef | undefined,
      language: NotificationCopyLanguage
    ): void {
      const key = ref === undefined ? undefined : (ref.scope === 'job-title' ? ref.definitionId : ref.key)
      const dedupeKey = `action:${record.id}:${actionId}:${key ?? ''}:${language}`
      if (reportedUnresolved.has(dedupeKey)) return
      reportedUnresolved.add(dedupeKey)
      input.diagnostics?.({
        code: 'action-label-unresolved',
        at: input.now(),
        recordId: record.id,
        eventTypeId: record.eventTypeId,
        ...(key === undefined ? {} : { key }),
        language,
        reason: actionId
      })
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
    signalSeverity?: NotificationSignalSeverity,
    /** 规划器算好的免打扰决定：路由拿它，不再自己重算（同一决定两处共用）。 */
    quietHours?: { inside: boolean; bypassed: boolean }
  ): Promise<{
    record: NotificationRecord
    pushBackoff: Readonly<Record<string, NotificationPushBackoff>>
    /** 桌面这一跳没弹出来（`show()` 返回 `ok:false` 或平台不支持）：P7 的唯一来源。 */
    desktopBlocked: boolean
    /** 这次**没被尝试**的表面（免打扰 / 开关关着）：回执据此说「没测」而不是「没到」。 */
    suppressedLevels: readonly NotificationSuppressedLevel[]
    transition?: NotificationPushTransition
  }> {
    const content = await resolveContent(record)
    const attempts = await routeTransientDelivery(record, settings, input.deliveryHooks ?? {}, input.clock, content, quietHours)
    const delivery: NotificationRecord['delivery'] = { ...record.delivery }
    const suppressedLevels: NotificationSuppressedLevel[] = []
    let desktopBlocked = false
    for (const attempt of attempts) {
      if (attempt.channel !== 'toast' && attempt.channel !== 'popup' && attempt.channel !== 'desktop') continue
      if (attempt.result === 'skipped') {
        const reason = suppressionReason(attempt.reason)
        if (reason !== undefined) suppressedLevels.push({ level: attempt.channel, reason })
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
      suppressedLevels,
      ...(pushOutcome?.transition === undefined ? {} : { transition: pushOutcome.transition })
    }
  }

  /** `skipped` 的原因里哪几种属于「根本没试」：其余（`*-unavailable`）是「想试但没有入口」。 */
  function suppressionReason(reason: string | undefined): NotificationSuppressedLevel['reason'] | undefined {
    if (reason === 'quiet-hours') return 'quiet-hours'
    if (reason === 'toast-disabled') return 'toast-disabled'
    if (reason === 'popup-disabled') return 'popup-disabled'
    if (reason === 'desktop-disabled') return 'desktop-disabled'
    return undefined
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
    // 目标通道由派生入口给出（`runtime-ready` 恰好一条），不再读 `settings.push.channelId`——
    // 那个字段没有任何生产写入方，读它等于让推送目标悬空（技术方案 §1）。
    const pushChannel = await (input.resolvePushChannel?.() ?? null) ?? { ok: false as const, reason: 'push-unavailable' as const, enabledChannelCount: 0, multiple: false }
    if (!pushChannel.ok && pushChannel.multiple) {
      input.diagnostics?.({ code: 'push-multiple-enabled', count: pushChannel.enabledChannelCount, at })
    }
    const channelId = pushChannel.ok ? pushChannel.channelId : null
    const current = channelId === null ? undefined : pushBackoff[channelId]
    const previousHighest = delivery.push?.highestSeverity
    const highest = (sent: boolean): NotificationSignalSeverity | undefined => {
      if (!sent || signalSeverity === undefined) return previousHighest
      if (previousHighest === undefined) return signalSeverity
      return SIGNAL_SEVERITY_RANK[signalSeverity] > SIGNAL_SEVERITY_RANK[previousHighest]
        ? signalSeverity
        : previousHighest
    }

    // 事件级开关的兜底：规划层已经不排手机，但严重度升级与手动重投不经过规划。
    // 明确关掉的事件在这里直接不发，也不写 `delivery.push`——「读者选择不推」不是一次失败。
    if ((settings.channelEvents ?? {})[record.eventTypeId] === false) {
      return { pushBackoff }
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
 * 成品里**平台不允许发出去**的三种东西（契约 v2.56：只拦不改）。
 *
 * 这里不判断「该说哪句话」——那是源头的事；只判断这句话里有没有暴露我们的内部形状，
 * 或承诺一个当前表面做不到的动作。命中就整条按不可发处理（兜底句），**绝不替它改词**。
 */
function looksUnsendable(text: string): boolean {
  if (text.trim().length === 0) return true
  // 花括号占位符：`{taskName}` 这种没填完的骨架。
  if (/\{\s*\w+\s*\}/u.test(text)) return true
  // 裸键：`notification.event.…` / `ui.state.…` 这类 `a.b.c` 形态（点号分段、全小写）。
  if (/\b[a-z][a-z0-9]*(?:[.-][a-z0-9]+){2,}\b/u.test(text) && !/\b[A-Z]/.test(text)) return true
  // 指向本条通知的动作指令：判定只有一处（`findActionDirective`），这里不另立词表。
  return findActionDirective(text) !== null
}

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
