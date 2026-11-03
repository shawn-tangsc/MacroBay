/**
 * 取证模式（**只认环境变量，不进界面、不落库、不加 IPC**）。
 *
 * 为什么需要它：门禁要求七项真机证据齐全才 `supported`，而「收、发、重连、重启恢复、代理」
 * 这五项都需要运行时真的在跑；运行时又只在 `supported` 之后才启动。新装机器上于是死锁：
 * 没证据 → 不能启用 → 不能跑 → 取不到证据。这不是测试便利，是产品缺陷（台账 R6a：应用内必须能
 * 跑一次真实 smoke 并由主进程自己写证据）；本开关只是**临时取证通道**，下一版真正的修法落地后必须删掉。
 *
 * 三条边界（Chief 2026-11-04 批）：
 * - 只对**指定的、尚未 supported 的**适配器生效；已 supported 的忽略它；
 * - **不改任何状态**：不写 evidence、不翻 supported、不标 enabled；数据库一行都不写；
 * - 不加这个变量时，本模块恒为 null，所有判定与今天逐字节一致。
 */
import { channelAdapterKeys, type ChannelAdapterKey } from './ChannelManagementPredicates'

let overrideAdapter: ChannelAdapterKey | null = null

/** 由主进程启动时调用一次；返回值便于启动日志说明「这次是取证模式」。 */
export function setChannelAcceptanceOverride(value: string | null | undefined): ChannelAdapterKey | null {
  const key = value?.trim() ?? ''
  overrideAdapter = (channelAdapterKeys as readonly string[]).includes(key) ? key as ChannelAdapterKey : null
  return overrideAdapter
}

export function channelAcceptanceOverride(): ChannelAdapterKey | null {
  return overrideAdapter
}

/** 拼进支持判定的 SQL 片段；`column` 是适配器键列（如 `c.adapter_key`）。 */
export function acceptanceOverrideSql(column: string): string {
  return overrideAdapter === null ? '' : ` or ${column} = '${overrideAdapter}'`
}

/** 拼进「未支持则该隔离」的 SQL：取证中的那一个不许被启动期/退出期围栏掉。 */
export function acceptanceOverrideExclusionSql(column: string): string {
  return overrideAdapter === null ? '' : ` and ${column} <> '${overrideAdapter}'`
}
