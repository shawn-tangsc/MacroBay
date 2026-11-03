/**
 * 用户点「启用」时的现场自检与启用（R6a 的落地形态）。
 *
 * 为什么不能靠平台的「七项真机验收」挡用户：那是**对外声明支持**的门槛，不是这位用户能不能用的门槛。
 * 拿它挡人，新装机就会死锁——没证据不能开、不能开就取不到证据。所以这里的分工是：
 * - 自检通过 → 只在这条通道上启用（进程内把该适配器当作已支持，退出即还原，**不写库、不翻目录**）；
 * - 自检失败 → 一行审计记下具体原因，把 `channel-smoke-failed` 与原因码交回界面说人话。
 */
import type { AgentChannelType } from '../schemas/channelSchemas'
import type { ChannelManagementResult, ChannelManagementSafeView } from './ChannelManagementContracts'
import { setChannelAcceptanceOverride } from './channelAcceptanceOverride'

export type ChannelSmokeResult = { ok: true } | { ok: false; code: string }

export type ChannelSmokeEnableDeps = {
  smoke: (channel: { id: string; type: AgentChannelType }) => Promise<ChannelSmokeResult>
  /** 失败时记一行审计（动作沿用 request-enable，原因写进 code）。 */
  audit: (code: string) => void
  /** 同一条启用链：调用方负责凭据检查、生命周期 owner 与运行时启动。 */
  enable: () => ChannelManagementResult | Promise<ChannelManagementResult>
}

export async function requestSmokeEnabledChannel(
  deps: ChannelSmokeEnableDeps,
  input: { channel: NonNullable<ChannelManagementSafeView> }
): Promise<ChannelManagementResult> {
  const channel = input.channel
  const smoke = await deps.smoke({ id: channel.id, type: channel.type })
  if (!smoke.ok) {
    deps.audit(smoke.code)
    return { ok: false, code: 'channel-smoke-failed', channel, reason: smoke.code }
  }
  setChannelAcceptanceOverride(channel.type)
  try {
    return await deps.enable()
  } finally {
    setChannelAcceptanceOverride(null)
  }
}
