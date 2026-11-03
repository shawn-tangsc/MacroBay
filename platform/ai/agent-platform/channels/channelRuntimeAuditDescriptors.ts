import type { ChannelInboundAuditCode } from './ChannelInboundRepository'

/**
 * 运行审计码 → 级别 + 文案键。**唯一一张表**：新增一个码，这里和文案表一起改，
 * 否则那个码在界面上既没有正确级别、也没有人话。
 *
 * 分级口径（Chief 2026-11-04 定，R188）：`ERROR` 只给**真的坏了**的 5 个码；
 * 其余 4 个是「按规则忽略/跳过」这类正常处置，降 `WARN`。
 * 查不到的码由调用方按 `WARN` + 兜底句处理——**宁可当提醒，不许当故障**。
 */
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

export function describeChannelRuntimeAudit(
  code: string
): ChannelRuntimeAuditDescriptor | undefined {
  return (channelRuntimeAuditDescriptors as Readonly<Record<string, ChannelRuntimeAuditDescriptor>>)[code]
}
