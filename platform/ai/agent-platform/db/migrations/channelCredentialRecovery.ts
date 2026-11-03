import type { AgentPlatformMigration } from '../createAgentPlatformDatabase'

/**
 * 凭据恢复的重试计数。
 *
 * 为什么要一列：`revoked-cleanup` / `needs-recovery` 里的操作以前是「每次启动再试一次、每次在
 * 同一个地方失败」，状态原地不动——用户看到的是 `credential_health = unavailable` 一直不变，
 * 而库里几条 `recovery-pending` 永远压着。有了计数才能给「重试到上限就落 unavailable + 一行审计」
 * 一个可判定的边界，而不是靠天吃饭。
 *
 * 计数只增不减；操作一旦完成或放弃就不再进 `pendingOperations()`，所以不需要清零。
 */
export const channelCredentialRecovery: AgentPlatformMigration[] = [
  {
    id: '0050_channel_management_recovery_attempts',
    up: `
      alter table channel_management_operations add column recovery_attempts integer not null default 0;
    `
  }
]
