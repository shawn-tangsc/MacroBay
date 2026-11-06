import type { AgentPlatformMigration } from '../createAgentPlatformDatabase'

/**
 * 送信失败要留下原因。
 *
 * 用户 2026-11-04 连续收到四句「处理失败，请稍后重试。」，而库里
 * `channel_dispatch_runs` 只有 `status=failed`、**没有任何原因字段**——真实原因（助手那一轮
 * 第一毫秒就抛错，例如「会话不属于这个助手」）从头到尾没留下。同一类问题已经反复出现：
 * 状态记了、原因丢了，读者只能看到套话。
 *
 * `error_code` 是闭集（给界面翻人话、给排查归类），`error_detail` 是脱敏截断后的原始说明（只给排查用）。
 */
export const channelDispatchFailureReason: AgentPlatformMigration[] = [
  {
    id: '0053_channel_dispatch_failure_reason',
    up: `
      alter table channel_dispatch_runs add column error_code text;
      alter table channel_dispatch_runs add column error_detail text;
    `
  }
]
