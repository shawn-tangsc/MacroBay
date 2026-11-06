/**
 * 连接生命周期：起、停两件事写进**面板能读到的那张运行审计表**（`channel_runtime_audits`）。
 *
 * 为什么不新建表：`channel_runtime_generations` 每频道只有一行、重启即覆盖，做不到「什么时候停过」；
 * 而运行审计表本来就是追加式的、有索引、有 500 行裁剪、有分页 IPC——复用它，代价只有两个写入点。
 *
 * 两条纪律：
 * - **只在状态真的变化时写**（由调用方的运行态标志保证），不许每次轮询成功都写；
 * - 数值/原因照旧走已有异常码（409、401 之类），这里只管「起来」「停了」。
 */
import type { AgentPlatformDatabase } from '../db/createAgentPlatformDatabase'
import { recordRuntimeAudit } from './channelRuntimeAuditRetention'

export type ChannelRuntimeLifecycleCode = 'channel-runtime-started' | 'channel-runtime-stopped'

export const channelRuntimeLifecycleCodes = [
  'channel-runtime-started',
  'channel-runtime-stopped'
] as const satisfies readonly ChannelRuntimeLifecycleCode[]

export function lifecycleCodeOf(state: 'started' | 'stopped'): ChannelRuntimeLifecycleCode {
  return state === 'started' ? 'channel-runtime-started' : 'channel-runtime-stopped'
}

/** 写一条起停记录；裁剪与保留期沿用运行审计表那一套（每频道最近 500 行）。 */
export function recordRuntimeLifecycle(
  database: AgentPlatformDatabase,
  channelId: string,
  state: 'started' | 'stopped',
  generation: number,
  now = new Date()
): void {
  recordRuntimeAudit(database, channelId, generation, lifecycleCodeOf(state), now)
}
