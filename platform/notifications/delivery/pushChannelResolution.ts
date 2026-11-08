/**
 * 「这条推送发给哪条通道」的**唯一派生入口**（技术方案 §1）。
 *
 * 判据只有一条：通道投影里的 `state === 'runtime-ready'`（那是「适配器可用 + 凭据在 + 已请求启用 +
 * 运行时接通」合成的唯一一档）。**不许**在调用处自己拼「`requestedEnabled` && `credential.status`」——
 * 那就是第二套判据，两处迟早一个说可用、一个说不可用。
 *
 * 三档，闭集：
 * - 恰好 1 条 → 用它，并把**名字**一起交出去（成功句「已发到 {通道名}（测试）」要有来源）；
 * - 0 条 → `push-unavailable`（配置事实，不是瞬时失败）；
 * - ≥2 条 → 同样 `push-unavailable`，另记一条 `push-multiple-enabled` 诊断。**不发明第七个 reason 码**：
 *   真实推送此刻就是推不出去，界面上多一个码只会让读者以为「有办法重试」。
 *
 * 只读数传进来的那一份；不缓存、不再查一次——判定那一刻的数字与调用方拿到的是同一次的结果。
 */
export type PushChannelCandidate = {
  id: string
  name: string
  state: string
}

export type PushChannelDiagnosticCode = 'push-multiple-enabled'

export type PushChannelResolution =
  | { ok: true; channelId: string; channelName: string }
  | {
    ok: false
    reason: 'push-unavailable'
    /** **实际处于 `runtime-ready` 的条数**（0 或 ≥2）。界面要印「你启用了 N 条通道…」，必须同一次数出来。 */
    enabledChannelCount: number
    /** ≥2 时为真：调用方据此记一条 `push-multiple-enabled`，0 条时不记（那不是配置冲突）。 */
    multiple: boolean
  }

export function resolvePushChannel(
  channels: readonly PushChannelCandidate[],
  report?: (code: PushChannelDiagnosticCode, count: number) => void
): PushChannelResolution {
  const ready = channels.filter((channel) => channel.state === 'runtime-ready')
  const only = ready.length === 1 ? ready[0] : undefined
  if (only !== undefined) return { ok: true, channelId: only.id, channelName: only.name }
  const multiple = ready.length >= 2
  if (multiple) report?.('push-multiple-enabled', ready.length)
  return { ok: false, reason: 'push-unavailable', enabledChannelCount: ready.length, multiple }
}

/** 没有可派生目标时的稳定值：三处调用点的 fail-closed 形态只写一次。 */
export const NO_PUSH_CHANNEL: PushChannelResolution = {
  ok: false,
  reason: 'push-unavailable',
  enabledChannelCount: 0,
  multiple: false
}
