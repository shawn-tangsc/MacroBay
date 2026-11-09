import type { JobRuntime } from '@platform/jobs'

import type { ChannelRuntimeAuditPruneResult } from './channelRuntimeAuditPrune'

export const channelRuntimeAuditRetentionJobId = 'platform.channelRuntimeAuditRetention'

/**
 * 运行审计的保留期任务（B3）：每天把每个频道超量的审计行裁掉，并把**删了多少**写进任务日志。
 *
 * 为什么还要这个任务（写入时已经裁过）：写入只裁**当前这个频道**，而「读者换了通道/停用了某条」
 * 时其它频道没人写、也就没人裁；周期任务是唯一覆盖「所有频道、无人写入」那一半的调用者。
 * 与其它保留期任务同一套：`@platform/jobs` 注册，**不自造定时器**。
 */
export type ChannelRuntimeAuditRetentionTarget = Readonly<{
  prune: () => ChannelRuntimeAuditPruneResult
}>

export function registerChannelRuntimeAuditRetentionJob(
  jobRuntime: JobRuntime,
  deps: Readonly<{ audits: () => ChannelRuntimeAuditRetentionTarget; timeZone: () => string }>
): void {
  jobRuntime.registerHandler(channelRuntimeAuditRetentionJobId, async (_payload, context) => {
    const { removedFailureRows, removedLifecycleRows } = deps.audits().prune()
    await context.log({
      level: 'info',
      message: `Channel runtime audit retention: ${removedFailureRows} failure row(s) and ${removedLifecycleRows} lifecycle row(s) removed.`
    })
  })

  jobRuntime.setSchedule({
    id: channelRuntimeAuditRetentionJobId,
    owner: 'platform',
    handlerId: channelRuntimeAuditRetentionJobId,
    title: { 'zh-CN': '清理通道运行日志', 'en-US': 'Channel runtime log retention' },
    audience: 'internal' as const,
    // 夜间序列 4 / 40 / 50 / 55 按此顺序排：本任务占 **4 分**，40 分是通知保留任务，
    // 撞同一分钟会让两条裁剪同时抢库（而且谁先谁后看不出）。
    trigger: { kind: 'cron', expression: '4 3 * * *', timezone: deps.timeZone() },
    payload: {}
  })
}
