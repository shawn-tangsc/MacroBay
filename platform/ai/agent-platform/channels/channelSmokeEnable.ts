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
import { releaseChannelAcceptance, retainChannelAcceptance } from './channelAcceptanceOverride'

export type ChannelSmokeResult =
  | { ok: true }
  | {
    ok: false
    code: string
    /** 脱敏后的 Chromium 错误名（`ERR_...`）；只用于日志排查，界面不显示。 */
    transportError?: string
    /** 这次请求实际走的代理（`PROXY host:port` / `DIRECT`）；同样是诊断用，界面不显示。 */
    proxy?: string
    /** 这次用的出网入口（`session` / `net`）。 */
    fetch?: string
  }

/**
 * `reason` 的闭集（界面按它说人话）。**任何没落进这里的码都要被归一**，否则界面只能显示
 * 「原因没有上报」——用户看到的就是「启用失败但不知道为什么」。
 */
export const CHANNEL_SMOKE_REASONS = [
  'telegram-credential-missing',
  'telegram-provider-rejected',
  'telegram-conflict',
  'telegram-network-unavailable',
  'telegram-proxy-unavailable',
  'telegram-rate-limited',
  // 凭据根本没存：与上面四个同属「用户能自己修」的原因，必须留在闭集里。
  'channel-credential-missing',
  // 这个适配器还没实现自检（非 telegram）：保留原码，别伪造成网络问题。
  'adapter-not-supported'
] as const

export type ChannelSmokeReason = (typeof CHANNEL_SMOKE_REASONS)[number]

function normalizeReason(code: string | undefined, adapterType: string): ChannelSmokeReason {
  if (code && (CHANNEL_SMOKE_REASONS as readonly string[]).includes(code)) return code as ChannelSmokeReason
  // 超时/异常/空码都属于「这一次没连上」：给网络不可用；非 telegram 归到未支持。
  return adapterType === 'telegram' ? 'telegram-network-unavailable' : 'adapter-not-supported'
}

export type ChannelSmokeEnableDeps = {
  smoke: (channel: { id: string; type: AgentChannelType }) => Promise<ChannelSmokeResult>
  /** 失败时记一行审计（动作沿用 request-enable，原因写进 code，脱敏细节进 summary）。 */
  audit: (code: string, summary?: Record<string, string>) => void
  /** 同一条启用链：调用方负责凭据检查、生命周期 owner 与运行时启动。 */
  enable: () => ChannelManagementResult | Promise<ChannelManagementResult>
}

export async function requestSmokeEnabledChannel(
  deps: ChannelSmokeEnableDeps,
  input: { channel: NonNullable<ChannelManagementSafeView> }
): Promise<ChannelManagementResult> {
  const channel = input.channel
  let smoke: ChannelSmokeResult
  try {
    smoke = await deps.smoke({ id: channel.id, type: channel.type })
  } catch {
    // 超时、解密失败、fetch 抛出：一律归一，绝不让原因空着。
    smoke = { ok: false, code: 'telegram-network-unavailable' }
  }
  if (!smoke.ok) {
    const reason = normalizeReason(smoke.code, channel.type)
    // 三条事实原样进审计 summary：下次排查不用再猜是代理没生效、DNS、还是连接被重置。
    const detail = {
      ...(smoke.transportError ? { transportError: smoke.transportError } : {}),
      ...(smoke.proxy ? { proxy: smoke.proxy } : {}),
      ...(smoke.fetch ? { fetch: smoke.fetch } : {})
    }
    deps.audit(reason, Object.keys(detail).length > 0 ? detail : undefined)
    return { ok: false, code: 'channel-smoke-failed', channel, reason }
  }
  // 放行必须活到这条通道停用/删除为止：收消息的轮询宿主第一拍就排在这次调用之后，
  // 在 finally 里清掉它，等于让宿主一启动就判「没资格」并静默退出（用户 2026-11-04 的故障）。
  retainChannelAcceptance(channel.type)
  try {
    const result = await deps.enable()
    if (result.ok !== true) releaseChannelAcceptance(channel.type)
    return result
  } catch (error) {
    releaseChannelAcceptance(channel.type)
    throw error
  }
}
