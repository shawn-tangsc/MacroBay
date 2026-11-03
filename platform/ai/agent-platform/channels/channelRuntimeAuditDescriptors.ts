import type { ChannelInboundAuditCode } from './ChannelInboundRepository'

/**
 * 运行审计码 → 级别 + 文案键。**唯一一张表**：新增一个码，这里和文案表一起改，
 * 否则那个码在界面上既没有正确级别、也没有人话。
 *
 * 分级口径（Chief 2026-11-04 定，R188）：`ERROR` 只给**真的坏了**的 5 个码；
 * 其余 4 个是「按规则忽略/跳过」这类正常处置，降 `WARN`。
 * 查不到的码由调用方按 `WARN` + 兜底句处理——**宁可当提醒，不许当故障**。
 */
import type { ChannelRuntimeFailureMirrorCode } from './channelRuntimeFailureMirror'
import type { ChannelRuntimeLifecycleCode } from './channelRuntimeLifecycle'

export type ChannelRuntimeAuditLevel = 'INFO' | 'WARN' | 'ERROR'

export type ChannelRuntimeAuditCopyKey =
  | 'runtimePolicyDenied'
  | 'runtimeMentionRequired'
  | 'runtimeContentRejected'
  | 'runtimeReceiptWithoutWorkItem'
  | 'runtimeStaleGeneration'
  | 'runtimeAgentMissing'
  | 'runtimeWorkCapacityExhausted'
  | 'runtimeLifecycleFenced'
  | 'runtimeInboundFailed'

export type ChannelRuntimeAuditDescriptor = {
  level: ChannelRuntimeAuditLevel
  copyKey: ChannelRuntimeAuditCopyKey
}

export const channelRuntimeAuditDescriptors: Readonly<Record<ChannelInboundAuditCode, ChannelRuntimeAuditDescriptor>> = Object.freeze({
  // 真故障：处理失败、绑定丢失、代际失效、任务丢失、容量耗尽。
  'channel-inbound-failed': { level: 'ERROR', copyKey: 'runtimeInboundFailed' },
  'channel-agent-missing': { level: 'ERROR', copyKey: 'runtimeAgentMissing' },
  'channel-lifecycle-fenced': { level: 'ERROR', copyKey: 'runtimeLifecycleFenced' },
  'channel-receipt-without-work-item': { level: 'ERROR', copyKey: 'runtimeReceiptWithoutWorkItem' },
  'channel-work-capacity-exhausted': { level: 'ERROR', copyKey: 'runtimeWorkCapacityExhausted' },
  // 正常处置：被规则挡下、没 @、类型不支持、旧代际——它们是提醒，不是故障。
  'channel-policy-denied': { level: 'WARN', copyKey: 'runtimePolicyDenied' },
  'channel-mention-required': { level: 'WARN', copyKey: 'runtimeMentionRequired' },
  'channel-content-rejected': { level: 'WARN', copyKey: 'runtimeContentRejected' },
  'channel-stale-generation': { level: 'WARN', copyKey: 'runtimeStaleGeneration' }
})

/**
 * 连接起停：**不是异常**，所以级别 INFO、前缀「运行：」，与「运行异常：」分开。
 * 这两条只反映「起来了 / 停了」，失败原因仍走上面的异常码。
 */
export type ChannelRuntimeLifecycleCopyKey = 'runtimeStarted' | 'runtimeStopped'

export const channelRuntimeLifecycleDescriptors: Readonly<
  Record<ChannelRuntimeLifecycleCode, { level: 'INFO'; copyKey: ChannelRuntimeLifecycleCopyKey }>
> = Object.freeze({
  'channel-runtime-started': { level: 'INFO', copyKey: 'runtimeStarted' },
  'channel-runtime-stopped': { level: 'INFO', copyKey: 'runtimeStopped' }
})

export function describeChannelRuntimeLifecycle(
  code: string
): { level: 'INFO'; copyKey: ChannelRuntimeLifecycleCopyKey } | undefined {
  return (channelRuntimeLifecycleDescriptors as Readonly<Record<string, { level: 'INFO'; copyKey: ChannelRuntimeLifecycleCopyKey }>>)[code]
}

/**
 * 镜像来的 Telegram 运行失败码：它们现在和运行审计同表，所以必须有人话与级别，
 * 否则面板上就是「运行异常：没有更多说明」——那正是用户抱怨的那件事。
 *
 * 分级：真的收不到消息的给 ERROR（抢占同一 bot、凭据被拒、网络不可达、启动失败、缺证据）；
 * 会重试、不一定算故障的给 WARN（限流、轮询失败、更新结构异常）。
 */
export type ChannelTelegramFailureCopyKey =
  | 'telegramConflict'
  | 'telegramNetworkUnavailable'
  | 'telegramProxyUnavailable'
  | 'telegramPollFailed'
  | 'telegramProviderRejected'
  | 'telegramRateLimited'
  | 'telegramUpdateInvalid'
  | 'telegramRuntimeStartFailed'
  | 'telegramRuntimeEvidenceMissing'

export const channelTelegramFailureDescriptors: Readonly<
  Record<ChannelRuntimeFailureMirrorCode, { level: ChannelRuntimeAuditLevel; copyKey: ChannelTelegramFailureCopyKey }>
> = Object.freeze({
  'telegram-conflict': { level: 'ERROR', copyKey: 'telegramConflict' },
  'telegram-provider-rejected': { level: 'ERROR', copyKey: 'telegramProviderRejected' },
  'telegram-network-unavailable': { level: 'ERROR', copyKey: 'telegramNetworkUnavailable' },
  'telegram-proxy-unavailable': { level: 'ERROR', copyKey: 'telegramProxyUnavailable' },
  'telegram-runtime-start-failed': { level: 'ERROR', copyKey: 'telegramRuntimeStartFailed' },
  'telegram-runtime-evidence-missing': { level: 'ERROR', copyKey: 'telegramRuntimeEvidenceMissing' },
  'telegram-rate-limited': { level: 'WARN', copyKey: 'telegramRateLimited' },
  'telegram-poll-failed': { level: 'WARN', copyKey: 'telegramPollFailed' },
  'telegram-update-invalid': { level: 'WARN', copyKey: 'telegramUpdateInvalid' }
})

export function describeChannelTelegramFailure(
  code: string
): { level: ChannelRuntimeAuditLevel; copyKey: ChannelTelegramFailureCopyKey } | undefined {
  return (channelTelegramFailureDescriptors as Readonly<
    Record<string, { level: ChannelRuntimeAuditLevel; copyKey: ChannelTelegramFailureCopyKey }>
  >)[code]
}

export function describeChannelRuntimeAudit(
  code: string
): ChannelRuntimeAuditDescriptor | undefined {
  return (channelRuntimeAuditDescriptors as Readonly<Record<string, ChannelRuntimeAuditDescriptor>>)[code]
}
