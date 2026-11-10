/**
 * QQ 机器人（v2）网关的**帧解析与关闭码判定**。
 *
 * 协议依据（QQ 机器人官方文档 › 开发文档 › 起步指南 › 事件订阅与通知）：
 * - 「通用数据结构」：上下行同一结构 `{ id, op, d, s, t }`；`s` 是下行序号，心跳要带最后收到的一个；
 * - 「opcode」：0 Dispatch、1 Heartbeat、2 Identify、6 Resume、7 Reconnect、9 Invalid Session、
 *   10 Hello、11 Heartbeat ACK；12 / 13 属 HTTP 回调模式，这里不认识；
 * - 「WebSocket 方式」：HELLO 的 `d.heartbeat_interval` 是毫秒；心跳 `{op:1,d:<最后 s 或 null>}`；
 *   鉴权 `{op:2,d:{token,intents,shard,properties}}`（token 形如 `QQBot {AccessToken}`）；
 *   恢复 `{op:6,d:{token,session_id,seq}}`；该文末尾「WebSocket 错误码」表给了每个关闭码能否
 *   Resume、能否重新 Identify。
 *
 * 这一层只回答「这一帧是什么」「这个关闭码下一步该 Resume 还是 Identify」。坏帧返回 `null`，
 * 由上层记一条审计——把读不懂的帧当事件送进管道，比丢一条更糟。
 */

export type QqGatewayFrame =
  | Readonly<{ kind: 'hello'; heartbeatIntervalMs: number }>
  | Readonly<{ kind: 'heartbeat'; sequence: number | null }>
  | Readonly<{ kind: 'heartbeat-ack' }>
  | Readonly<{ kind: 'dispatch'; eventId: string | null; event: string; sequence: number; data: unknown }>
  | Readonly<{ kind: 'reconnect' }>
  /** 官方没写 `d` 的类型与含义：能读到布尔就照实记，读不到就是 null（上层按「不可恢复」处理）。 */
  | Readonly<{ kind: 'invalid-session'; resumable: boolean | null }>
  | Readonly<{ kind: 'unknown'; op: number }>

/** 单帧上限：网关一帧到这个尺寸只可能是出了别的问题，先别把内存吃掉。 */
export const QQ_GATEWAY_MAX_FRAME_BYTES = 1_000_000

export function parseQqGatewayFrame(raw: string): QqGatewayFrame | null {
  if (raw.length === 0 || raw.length > QQ_GATEWAY_MAX_FRAME_BYTES) return null
  let value: unknown
  try { value = JSON.parse(raw) } catch { return null }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const frame = value as { id?: unknown; op?: unknown; d?: unknown; s?: unknown; t?: unknown }
  if (typeof frame.op !== 'number' || !Number.isInteger(frame.op)) return null

  switch (frame.op) {
    case 10: {
      const interval = (frame.d as { heartbeat_interval?: unknown } | undefined)?.heartbeat_interval
      if (typeof interval !== 'number' || !Number.isFinite(interval) || interval <= 0) return null
      return Object.freeze({ kind: 'hello', heartbeatIntervalMs: interval })
    }
    case 1: {
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
      return Object.freeze({ kind: 'invalid-session', resumable: typeof frame.d === 'boolean' ? frame.d : null })
    case 0: {
      const event = frame.t
      const sequence = frame.s
      if (typeof event !== 'string' || event.length === 0) return null
      if (typeof sequence !== 'number' || !Number.isSafeInteger(sequence) || sequence < 0) return null
      const eventId = typeof frame.id === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(frame.id) ? frame.id : null
      return Object.freeze({ kind: 'dispatch', eventId, event, sequence, data: frame.d })
    }
    default:
      return Object.freeze({ kind: 'unknown', op: frame.op })
  }
}

/**
 * 下一次连接该 Resume 还是重新 Identify —— 只按官方那张错误码表判，不自己发明。
 *
 * 表里两列（能否 Resume / 能否 IDENTIFY）：
 * - 4008 / 4009：都是「是」→ 先 Resume；
 * - 4006 / 4007：Resume 否、IDENTIFY 是 → 重新 Identify；
 * - 4900~4913 内部错误：Resume 否、IDENTIFY 是 → 重新 Identify；
 * - 4001 / 4002 / 4010~4014 / 4914 / 4915：两列都「否」→ 连也白连，要人处理（参数、权限、沙箱环境、封禁）。
 *
 * 表外的码：4xxx 按该文「其他错误，请重新发起 identify」；非 4xxx 是传输层正常/异常关闭，
 * 按该文「断开重连 gateway 后不需要发送重新登录 Opcode 2 Identify」走 Resume。
 */
export type QqGatewayCloseDisposition = 'resume' | 'identify' | 'fatal'

/** 表里两列都「否」的码：连着也白连，得由人处理参数、权限、环境或封禁。 */
const QQ_FATAL_CLOSE_CODES: ReadonlySet<number> = new Set([4_001, 4_002, 4_010, 4_011, 4_012, 4_013, 4_014, 4_914, 4_915])

export function qqGatewayCloseDisposition(code: number): QqGatewayCloseDisposition {
  if (!Number.isInteger(code) || code < 4_000 || code > 4_999) return 'resume'
  if (QQ_FATAL_CLOSE_CODES.has(code)) return 'fatal'
  if (code === 4_008 || code === 4_009) return 'resume'
  // 4006 / 4007 与 4900~4913：Resume 否、Identify 是；表外 4xxx 按「其他错误，请重新发起 identify」。
  return 'identify'
}

/** 鉴权：`token` 由调用方按官方格式交进来（`QQBot {AccessToken}`），这里不猜前缀。 */
export function buildQqIdentify(token: string, intents: number): string {
  return JSON.stringify({
    op: 2,
    d: {
      token,
      intents,
      // 不做分片：官方注明「若无需分片，使用 [0, 1] 即可」。
      shard: [0, 1],
      properties: { $os: 'desktop', $browser: 'MacroBay', $device: 'MacroBay' }
    }
  })
}

export function buildQqResume(token: string, sessionId: string, sequence: number): string {
  return JSON.stringify({ op: 6, d: { token, session_id: sessionId, seq: sequence } })
}

export function buildQqHeartbeat(sequence: number | null): string {
  return JSON.stringify({ op: 1, d: sequence })
}
