/**
 * Discord Gateway 的**帧解析**（B1 之前的入站第一层）。
 *
 * 协议依据（写清出处，不按印象猜）：
 * - Discord Developers › Docs › Topical › Gateway › **Payload Structure**：每帧是
 *   `{ "op": int, "d": any, "s": int|null, "t": string|null }`，`s` 只在 dispatch 上有值；
 * - 同文 **Opcodes and Status Codes**：`0` Dispatch、`1` Heartbeat、`2` Identify、`6` Resume、
 *   `7` Reconnect、`9` Invalid Session、`10` Hello（`d.heartbeat_interval` 毫秒）、`11` Heartbeat ACK。
 *
 * 这一层只回答「这一帧是什么」。坏帧返回 `null`，由上层记 `discord-dispatch-invalid`——
 * 把读不懂的帧当消息送进管道，比丢一条更糟。
 */
export type DiscordGatewayFrame =
  | Readonly<{ kind: 'hello'; heartbeatIntervalMs: number }>
  | Readonly<{ kind: 'heartbeat'; sequence: number | null }>
  | Readonly<{ kind: 'heartbeat-ack' }>
  | Readonly<{ kind: 'dispatch'; event: string; sequence: number; data: unknown }>
  | Readonly<{ kind: 'reconnect' }>
  | Readonly<{ kind: 'invalid-session'; resumable: boolean }>
  | Readonly<{ kind: 'unknown'; op: number }>

/** 单帧上限：网关消息到不了 1 MB，超了当坏帧，别先把内存吃掉。 */
export const DISCORD_GATEWAY_MAX_FRAME_BYTES = 1_000_000

export function parseDiscordGatewayFrame(raw: string): DiscordGatewayFrame | null {
  if (raw.length === 0 || raw.length > DISCORD_GATEWAY_MAX_FRAME_BYTES) return null
  let value: unknown
  try { value = JSON.parse(raw) } catch { return null }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const frame = value as { op?: unknown; d?: unknown; s?: unknown; t?: unknown }
  if (typeof frame.op !== 'number' || !Number.isInteger(frame.op)) return null

  switch (frame.op) {
    case 10: {
      const interval = (frame.d as { heartbeat_interval?: unknown } | undefined)?.heartbeat_interval
      if (typeof interval !== 'number' || !Number.isFinite(interval) || interval <= 0) return null
      return Object.freeze({ kind: 'hello', heartbeatIntervalMs: interval })
    }
    case 1: {
      // 心跳的 `d` 是「最后一次收到的序号」或 null（还没收到过 dispatch）。
      const sequence = frame.d
      if (sequence === null || sequence === undefined) return Object.freeze({ kind: 'heartbeat', sequence: null })
      if (typeof sequence !== 'number' || !Number.isSafeInteger(sequence) || sequence < 0) return null
      return Object.freeze({ kind: 'heartbeat', sequence })
    }
    case 11:
      return Object.freeze({ kind: 'heartbeat-ack' })
    case 7:
      return Object.freeze({ kind: 'reconnect' })
    case 9:
      if (typeof frame.d !== 'boolean') return null
      return Object.freeze({ kind: 'invalid-session', resumable: frame.d })
    case 0: {
      const event = frame.t
      const sequence = frame.s
      if (typeof event !== 'string' || event.length === 0) return null
      if (typeof sequence !== 'number' || !Number.isSafeInteger(sequence) || sequence < 0) return null
      return Object.freeze({ kind: 'dispatch', event, sequence, data: frame.d })
    }
    default:
      // 未知 op 保留下来给上层判断（Identify/Resume 的回声等），不在这里悄悄吞掉。
      return Object.freeze({ kind: 'unknown', op: frame.op })
  }
}
