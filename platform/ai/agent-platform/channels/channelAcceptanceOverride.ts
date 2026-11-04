/**
 * 现场自检放行：用户在界面上把一条**尚未取证**的通道启用成功后，本进程内把它当作可用。
 *
 * 为什么需要它：门禁要求七项真机证据齐全才 `supported`，而「收、发、重连、重启恢复、代理」
 * 这五项都需要运行时真的在跑；运行时又只在 `supported` 之后才启动。新装机器上于是死锁：
 * 没证据 → 不能启用 → 不能跑 → 取不到证据。
 *
 * **放行的生命周期 = 这条通道在跑多久，不是「这一次调用」**（用户 2026-11-04 的教训）：
 * 以前它在 `requestSmokeEnabledChannel` 的 `finally` 里被清掉，而收消息的轮询宿主第一拍
 * 排在它之后——`isCurrentActive` 立刻判「这个频道没启用」，宿主**静默退出**，用户手机上
 * 发消息、应用里什么都没发生。放行必须活到通道停用/删除为止。
 *
 * 三条边界：
 * - 只对**指定的、尚未 supported 的**适配器生效；已 supported 的忽略它；
 * - **不改任何状态**：不写 evidence、不翻 supported、不标 enabled；数据库一行都不写；
 * - 引用计数：同一适配器多条通道同时启用，最后一条停用/删除才收回放行。
 */
import { channelAdapterKeys, type ChannelAdapterKey } from './ChannelManagementPredicates'

const retained = new Map<ChannelAdapterKey, number>()

function normalize(value: string | null | undefined): ChannelAdapterKey | null {
  const key = value?.trim() ?? ''
  return (channelAdapterKeys as readonly string[]).includes(key) ? key as ChannelAdapterKey : null
}

function sqlList(keys: readonly ChannelAdapterKey[]): string {
  return keys.map((key) => `'${key}'`).join(', ')
}

/** 整体替换（给启动/测试用）：传 null 等于清空所有放行。 */
export function setChannelAcceptanceOverride(value: string | null | undefined): ChannelAdapterKey | null {
  retained.clear()
  const key = normalize(value)
  if (key) retained.set(key, 1)
  return key
}

/** 这条通道启用了：本进程内放行它的适配器（可重入，引用计数 +1）。 */
export function retainChannelAcceptance(value: string): ChannelAdapterKey | null {
  const key = normalize(value)
  if (!key) return null
  retained.set(key, (retained.get(key) ?? 0) + 1)
  return key
}

/** 这条通道停用/删除了：收回一次放行；计数归零才真的不再放行。 */
export function releaseChannelAcceptance(value: string): void {
  const key = normalize(value)
  if (!key) return
  const count = (retained.get(key) ?? 0) - 1
  if (count > 0) retained.set(key, count)
  else retained.delete(key)
}

/** 当前被放行的适配器（供 SQL 拼接与诊断）。 */
export function channelAcceptanceOverrides(): ChannelAdapterKey[] {
  return [...retained.keys()]
}

/** 兼容旧读法：只关心「有没有放行」的地方读第一个。 */
export function channelAcceptanceOverride(): ChannelAdapterKey | null {
  return [...retained.keys()][0] ?? null
}

/** 拼进支持判定的 SQL 片段；`column` 是适配器键列（如 `c.adapter_key`）。 */
export function acceptanceOverrideSql(column: string): string {
  const keys = channelAcceptanceOverrides()
  return keys.length === 0 ? '' : ` or ${column} in (${sqlList(keys)})`
}

/** 拼进「未支持则该隔离」的 SQL：正在放行的这几个不许被启动期/退出期围栏掉。 */
export function acceptanceOverrideExclusionSql(column: string): string {
  const keys = channelAcceptanceOverrides()
  return keys.length === 0 ? '' : ` and ${column} not in (${sqlList(keys)})`
}
