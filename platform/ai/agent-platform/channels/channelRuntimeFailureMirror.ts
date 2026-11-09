/**
 * 运行时失败码的镜像：Telegram 的轮询失败原本只写进 `channel_telegram_runtime_audits`，
 * 而设置页日志面板读的是 `channel_runtime_audits` —— 于是 409/401 这类最该看的失败，
 * 面板里一条都没有（用户说「日志不全」就是这个）。
 *
 * 定案（Chief 2026-11-04）：**在写入点 mirror 一份**，不让面板去合并两张表——
 * 合并要维护两个游标与归并顺序，还要保证两表时间序一致，复杂度不成比例。
 *
 * 三条纪律：
 * - mirror 与主写入**同一事务**：主表成功、镜像失败就整体失败，不许出现「诊断表有、面板表没有」；
 * - 码原样镜像（`telegram-conflict` 这类），面板靠描述表转人话，别在写的时候改写成大词；
 * - mirror 来的行与其它行一样吃 500 行裁剪预算——起停行很稀（只在状态变化时写），
 *   只有在一个频道之后又发生 500 条失败时才会被挤掉，这是保留期本身的口径。
 */
import type { AgentPlatformDatabase } from '../db/createAgentPlatformDatabase'
import { appendRuntimeAudit } from './channelRuntimeAuditRetention'

/** 会被镜像到面板读的那张表的运行时失败码。新增码时同步加在这里，守卫用例会核一致性。 */
export const channelRuntimeFailureMirrorCodes = [
  'telegram-rate-limited',
  'telegram-conflict',
  'telegram-provider-rejected',
  'telegram-network-unavailable',
  'telegram-proxy-unavailable',
  'telegram-poll-failed',
  'telegram-poll-timeout',
  'telegram-poll-retrying',
  'telegram-poll-recovered',
  'telegram-poll-abandoned',
  'telegram-update-invalid',
  'telegram-runtime-evidence-missing',
  'channel-runtime-owner-missing',
  'channel-runtime-generation-stale',
  'channel-runtime-owner-lost',
  'telegram-runtime-start-failed'
] as const

export type ChannelRuntimeFailureMirrorCode = (typeof channelRuntimeFailureMirrorCodes)[number]

export function isChannelRuntimeFailureMirrorCode(value: string): value is ChannelRuntimeFailureMirrorCode {
  return (channelRuntimeFailureMirrorCodes as readonly string[]).includes(value)
}

/**
 * 把一条运行时失败镜像进面板表。`generation` 允许为 null：启动期失败（证据缺失/启动失败）
 * 发生时还没有一条属于它的代际记录，编一个数字不如留空。
 */
export function mirrorRuntimeFailure(
  database: AgentPlatformDatabase,
  channelId: string,
  generation: number | null,
  code: ChannelRuntimeFailureMirrorCode,
  now: Date
): void {
  appendRuntimeAudit(database, channelId, generation, code, now)
}
