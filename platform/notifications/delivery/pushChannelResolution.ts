/**
 * 「这条推送发给哪些通道」的**唯一派生入口**（多通道方案 §5-1）。
 *
 * 判据只有一条：通道投影里的 `state === 'runtime-ready'`（那是「适配器可用 + 凭据在 + 已请求启用 +
 * 运行时接通」合成的唯一一档）。**不许**在调用处自己拼「`requestedEnabled` && `credential.status`」
 * ——那就是第二套判据，两处迟早一个说可用、一个说不可用。
 *
 * 两档，闭集：有 `runtime-ready` → 全部返回（按投影顺序）；一条都没有 → `push-unavailable`。
 * 用户 2026-11-12 拍板：多条同时启用是**合法状态**，所以这里不产生任何「配置冲突」诊断；
 * 失败只剩「一条都没有」这一档，`states` 直方图说明有通道但卡在哪一档（那是「没有」，不是「拿不到」）。
 *
 * 只读数传进来的那一份；不缓存、不再查一次——判定那一刻的数字与调用方拿到的是同一次的结果。
 */
export type PushChannelCandidate = {
  id: string
  name: string
  state: string
}

export type PushChannelTarget = { id: string; name: string }

export type PushChannelsResolution =
  | { ok: true; channels: readonly PushChannelTarget[] }
  | { ok: false; reason: 'push-unavailable'; /** 实际可用的条数：这里恒为 0（0 条 = 没有，不是拿不到）。 */ enabledChannelCount: number; states: Readonly<Record<string, number>> }

export function resolvePushChannels(channels: readonly PushChannelCandidate[]): PushChannelsResolution {
  const ready = channels.filter((channel) => channel.state === 'runtime-ready')
  if (ready.length > 0) return { ok: true, channels: ready.map((channel) => ({ id: channel.id, name: channel.name })) }
  const states: Record<string, number> = {}
  for (const channel of channels) states[channel.state] = (states[channel.state] ?? 0) + 1
  return { ok: false, reason: 'push-unavailable', enabledChannelCount: 0, states }
}

/** 没有派生入口时的稳定值：三处调用点的 fail-closed 形态只写一次（0 条 = 没有，不是拿不到）。 */
export const NO_PUSH_CHANNELS: PushChannelsResolution = {
  ok: false,
  reason: 'push-unavailable',
  enabledChannelCount: 0,
  states: {}
}
