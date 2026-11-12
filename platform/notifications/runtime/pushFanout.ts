import { SIGNAL_SEVERITY_RANK } from '../contracts/notificationContracts'
import type {
  NotificationDiagnosticsSink,
  NotificationPushBackoff,
  NotificationRecord,
  NotificationRuntimeSettings,
  NotificationSignalSeverity,
  PushChannelOutcome
} from '../contracts/notificationContracts'
import { aggregatePushDelivery } from '../delivery/aggregatePushDelivery'
import type { ChannelPushAttempt, ChannelPushHook, ChannelPushTarget } from '../delivery/channelPushPort'
import type { PushChannelsResolution } from '../delivery/pushChannelResolution'
import { recordPushOutcome, shouldSkipPush, type PushDeliveryOutcome } from '../delivery/pushBackoffPolicy'
import { pushDeliveryState } from '../delivery/pushDeliveryState'
import type { NotificationDeliveryContent } from './notificationRouting'

/** 熔断状态迁移的通知（与投递面共用一份词汇）：悬停 / 恢复各一条。 */
export type NotificationPushTransition = { kind: 'paused' | 'resumed'; channelId: string }

/**
 * 手机这一档的一次投递（多通道方案 §2–§4）：**唯一写 `delivery.push` 的地方**。
 *
 * 从 `notificationRuntimeDelivery.ts` 抽出来的理由只有一个：那个文件贴着体积上限；
 * 搬出来的只是「扇出 + 逐通道回执 + 聚合」这一段，判定仍是同一批纯函数
 * （`shouldSkipPush` / `pushDeliveryState` / `recordPushOutcome` / `aggregatePushDelivery`）。
 *
 * 四条纪律：
 * - 一条记录 = N 次尝试：端口被点名 N 个目标，回执 N 行，记录仍然只有一条；
 * - 退避按通道隔离：窗口内那条记 `queued` 且**不调用端口**，其余照发；
 * - 聚合只有四档，`sent-accepted` 当且仅当每条都 delivered；
 * - `highestSeverity` 只在**真的发出去了**（受理或未确认）时抬——推失败不算「已经告诉过读者」。
 */
export async function attemptChannelPush(input: {
  record: NotificationRecord
  delivery: NotificationRecord['delivery']
  settings: NotificationRuntimeSettings
  pushBackoff: Readonly<Record<string, NotificationPushBackoff>>
  content: NotificationDeliveryContent
  signalSeverity: NotificationSignalSeverity | undefined
  now: () => string
  resolvePushChannels?: () => Promise<PushChannelsResolution>
  pushHook?: ChannelPushHook
  diagnostics?: NotificationDiagnosticsSink
}): Promise<{
  pushBackoff: Readonly<Record<string, NotificationPushBackoff>>
  transition?: NotificationPushTransition
}> {
  const { record, delivery, settings, pushBackoff, content, signalSeverity } = input
  const nextBackoff: Record<string, NotificationPushBackoff> = { ...pushBackoff }
  let changed = false
  let transition: NotificationPushTransition | undefined
  const at = input.now()
  // 目标通道由派生入口给出（`runtime-ready` 有几条就有几条），不再读 `settings.push.channelId`——
  // 那个字段没有任何生产写入方，读它等于让推送目标悬空（技术方案 §1）。
  //
  // not-ok 时**必须留一行可查的原因**（2026-11-08）：以前这一支什么都不记，于是「装配漏了钩子」
  // 「漏了派生入口」「一条通道都没配」「配了但状态不对」四种完全不同的处境，在日志里长得一模一样，
  // 读者侧也只有一个 `push-unavailable` 可看。诊断码只进日志，读者的闭集一个码都不加。
  const resolvePushChannels = input.resolvePushChannels
  if (resolvePushChannels === undefined) {
    input.diagnostics?.({ code: 'push-resolver-missing', count: 0, at })
  }
  const resolution = resolvePushChannels === undefined ? null : await resolvePushChannels()
  if (resolution !== null && !resolution.ok) {
    if (Object.keys(resolution.states).length === 0) {
      // 一条通道都没有：配置事实，不是瞬时失败。
      input.diagnostics?.({ code: 'push-target-none', count: 0, at })
    } else {
      // 有通道、但没有一条 `runtime-ready`：带状态直方图说清卡在哪一档，**不含通道名与凭据**。
      input.diagnostics?.({ code: 'push-target-not-ready', count: resolution.enabledChannelCount, states: resolution.states, at })
    }
  }
  const targets: ChannelPushTarget[] = resolution?.ok === true
    ? resolution.channels.map((channel) => ({ channelId: channel.id, channelName: channel.name }))
    : []
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
  if (targets.length === 0 || !input.pushHook) {
    // 钩子缺席是**装配漏了出站端口**，与「没有可用通道」是两件事：分开记，下一次一眼定案。
    if (!input.pushHook) input.diagnostics?.({ code: 'push-hook-missing', count: 0, at })
    delivery.push = { state: 'failed', reason: 'push-unavailable', at, ...(previousHighest === undefined ? {} : { highestSeverity: previousHighest }) }
    return { pushBackoff }
  }

  // 退避隔离：在窗口内的通道记 `queued` 且**不调用端口**，其余照发（一条慢/一条坏不拖垮整轮）。
  // 结果先进一张按通道索引的表，最后**按投影顺序**摊开：库里的行序与读者看到的通道顺序一致。
  const byOutcome = new Map<string, PushChannelOutcome>()
  const toSend: ChannelPushTarget[] = []
  for (const target of targets) {
    if (shouldSkipPush(nextBackoff[target.channelId], at)) {
      byOutcome.set(target.channelId, { channelId: target.channelId, channelName: target.channelName, state: 'queued', reason: 'push-backoff', at })
      continue
    }
    toSend.push(target)
  }

  let attempts: readonly ChannelPushAttempt[] = []
  if (toSend.length > 0) {
    try {
      attempts = await input.pushHook({ ...record, delivery }, content, toSend)
    } catch {
      // 端口承诺不抛；真抛了也只当「这几条一条都没成」，不许把整条提交打回去。
      attempts = []
    }
  }
  const byChannel = new Map(attempts.map((attempt) => [attempt.channelId, attempt]))
  for (const target of toSend) {
    const result = byChannel.get(target.channelId)?.result ?? { ok: false, reason: 'channel-rejected' }
    // 记录上的状态词只由这一处映射给（与手动重投读同一张表）。
    const mapped = pushDeliveryState(result)
    // 熔断只认「确定失败」：`sent-unconfirmed`（发出去了、没拿到回执）既不是成功也不是失败。
    const outcome: PushDeliveryOutcome = mapped.state === 'sent-unconfirmed'
      ? 'unknown-after-send'
      : mapped.state === 'failed'
        ? 'failed'
        : 'sent-accepted'
    const decision = recordPushOutcome(nextBackoff[target.channelId], outcome, at)
    // `unknown-after-send` 与「本来就没失败过」返回原值：不写，保留「没有熔断记录」这个状态。
    if (decision.changed) {
      nextBackoff[target.channelId] = {
        channelId: target.channelId,
        failures: decision.failures,
        pausedUntil: decision.pausedUntil
      }
      changed = true
    }
    if (decision.transition === 'suspended') transition = { kind: 'paused', channelId: target.channelId }
    if (decision.transition === 'resumed') transition = { kind: 'resumed', channelId: target.channelId }
    byOutcome.set(target.channelId, {
      channelId: target.channelId,
      channelName: target.channelName,
      state: mapped.state,
      ...(mapped.reason === undefined ? {} : { reason: mapped.reason }),
      ...(result.messageId === undefined ? {} : { attemptId: result.messageId }),
      at
    })
  }

  const outcomes: PushChannelOutcome[] = targets
    .map((target) => byOutcome.get(target.channelId))
    .filter((outcome): outcome is PushChannelOutcome => outcome !== undefined)
  const aggregate = aggregatePushDelivery(outcomes)
  const anySent = outcomes.some((outcome) => outcome.state === 'sent-accepted' || outcome.state === 'sent-unconfirmed')
  const nextHighest = highest(anySent)
  const only = outcomes.length === 1 ? outcomes[0] : undefined
  delivery.push = {
    state: aggregate.state,
    ...(aggregate.reason === undefined ? {} : { reason: aggregate.reason }),
    at,
    channels: outcomes,
    // 顶层 `messageId` 只在「恰好一条通道且它拿到了回执」时写：N 条各有一个 id，逐条的都在 `channels[]`。
    ...(only?.attemptId === undefined ? {} : { messageId: only.attemptId }),
    ...(nextHighest === undefined ? {} : { highestSeverity: nextHighest })
  }
  return { pushBackoff: changed ? nextBackoff : pushBackoff, ...(transition === undefined ? {} : { transition }) }
}

