import { describe, expect, it } from 'vitest'

import {
  buildQqHeartbeat,
  buildQqIdentify,
  buildQqResume,
  parseQqGatewayFrame,
  qqGatewayCloseDisposition
} from './QqGatewayProtocol'

/**
 * QQ 机器人（v2）网关的**帧解析与关闭码判定**。
 *
 * 协议依据（QQ 机器人官方文档 › 开发文档 › 起步指南 › 事件订阅与通知）：
 * - 「通用数据结构」：上下行同一结构 `{ id, op, d, s, t }`；`s` 是下行序号，心跳要带最后收到的一个；
 * - 「opcode」：0 Dispatch、1 Heartbeat、2 Identify、6 Resume、7 Reconnect、9 Invalid Session、
 *   10 Hello、11 Heartbeat ACK、12/13 仅 HTTP 回调模式；
 * - 「WebSocket 方式」：HELLO 带 `d.heartbeat_interval` 毫秒；心跳 `{op:1,d:<最新 s 或 null>}`；
 *   鉴权 `{op:2,d:{token,intents,shard,properties}}`，`token` 形如 `QQBot {AccessToken}`；
 *   恢复 `{op:6,d:{token,session_id,seq}}`；末尾那张「WebSocket 错误码」表给了每个关闭码
 *   能不能 Resume、能不能重新 Identify。
 *
 * 这一层只回答「这一帧是什么」和「这个关闭码下一步该 Resume 还是 Identify」。
 */

describe('qq gateway frame parsing', () => {
  it('reads HELLO and the heartbeat interval it carries', () => {
    expect(parseQqGatewayFrame('{"op":10,"d":{"heartbeat_interval":45000}}')).toEqual({ kind: 'hello', heartbeatIntervalMs: 45_000 })
    // 间隔必须是正有限数，否则上层无法排心跳。
    for (const raw of ['{"op":10,"d":{}}', '{"op":10,"d":{"heartbeat_interval":0}}', '{"op":10,"d":{"heartbeat_interval":"45000"}}']) {
      expect(parseQqGatewayFrame(raw), raw).toBeNull()
    }
  })

  it('reads heartbeat, ACK, reconnect and the three invalid-session shapes', () => {
    expect(parseQqGatewayFrame('{"op":1,"d":251}')).toEqual({ kind: 'heartbeat', sequence: 251 })
    expect(parseQqGatewayFrame('{"op":1,"d":null}')).toEqual({ kind: 'heartbeat', sequence: null })
    expect(parseQqGatewayFrame('{"op":11}')).toEqual({ kind: 'heartbeat-ack' })
    expect(parseQqGatewayFrame('{"op":7}')).toEqual({ kind: 'reconnect' })
    // 官方只写「identify 或 resume 参数有错时返回该消息」，没说 d 的类型：原样记下，不猜。
    expect(parseQqGatewayFrame('{"op":9,"d":true}')).toEqual({ kind: 'invalid-session', resumable: true })
    expect(parseQqGatewayFrame('{"op":9,"d":false}')).toEqual({ kind: 'invalid-session', resumable: false })
    expect(parseQqGatewayFrame('{"op":9}')).toEqual({ kind: 'invalid-session', resumable: null })
  })

  it('reads a dispatch with its event name, sequence and event id', () => {
    expect(parseQqGatewayFrame('{"id":"event_1","op":0,"s":42,"t":"GROUP_AT_MESSAGE_CREATE","d":{"content":"hi"}}')).toEqual({
      kind: 'dispatch',
      eventId: 'event_1',
      event: 'GROUP_AT_MESSAGE_CREATE',
      sequence: 42,
      data: { content: 'hi' }
    })
    // 事件 id 只是可选字段：缺了也要能把事件送进去，靠 event key 的其他部分去重。
    expect(parseQqGatewayFrame('{"op":0,"s":42,"t":"READY","d":{}}')).toMatchObject({ kind: 'dispatch', eventId: null, event: 'READY' })
    expect(parseQqGatewayFrame('{"op":0,"s":42,"t":"READY","id":"","d":{}}')).toMatchObject({ kind: 'dispatch', eventId: null })
  })

  it('rejects malformed frames instead of guessing', () => {
    for (const raw of ['', 'not-json', '{}', '[]', 'null', '{"op":"0"}', '{"op":0,"t":""}', '{"op":0,"t":"READY"}', '{"op":0,"s":-1,"t":"READY"}', '{"op":1,"d":-1}', '{"op":1,"d":1.5}']) {
      expect(parseQqGatewayFrame(raw), raw).toBeNull()
    }
    expect(parseQqGatewayFrame(`{"op":11,"pad":"${'x'.repeat(1_000_001)}"}`)).toBeNull()
  })

  it('keeps an unknown opcode visible instead of dropping it', () => {
    expect(parseQqGatewayFrame('{"op":13,"d":{}}')).toEqual({ kind: 'unknown', op: 13 })
  })
})

describe('qq gateway close codes', () => {
  it('follows the official table for resume, identify and fatal codes', () => {
    // 「是否可以重试 RESUME / IDENTIFY」两列：都是「是」→ 先 Resume。
    for (const code of [4008, 4009]) expect(qqGatewayCloseDisposition(code), String(code)).toBe('resume')
    // 不能 Resume、可以重新 Identify。
    for (const code of [4006, 4007]) expect(qqGatewayCloseDisposition(code), String(code)).toBe('identify')
    // 内部错误 4900~4913：请重连（不可 Resume）。
    for (const code of [4900, 4901, 4913]) expect(qqGatewayCloseDisposition(code), String(code)).toBe('identify')
    // 两列都是「否」：连着也白连，要人处理（沙箱环境 / 封禁 / 参数与权限错误）。
    for (const code of [4001, 4002, 4010, 4011, 4012, 4013, 4014, 4914, 4915]) {
      expect(qqGatewayCloseDisposition(code), String(code)).toBe('fatal')
    }
  })

  it('resumes on a transport-level close and identifies on an unlisted protocol error', () => {
    // 非 4xxx：正常关闭 / 异常断开，按文档「断开重连后不需要重新 Identify」走 Resume。
    for (const code of [1_000, 1_001, 1_006]) expect(qqGatewayCloseDisposition(code), String(code)).toBe('resume')
    // 4xxx 里没列出来的，按文档「其他错误，请重新发起 identify」。
    for (const code of [4_000, 4_020, 4_999]) expect(qqGatewayCloseDisposition(code), String(code)).toBe('identify')
  })
})

describe('qq gateway wire builders', () => {
  it('builds identify, resume and heartbeat payloads the documented way', () => {
    expect(JSON.parse(buildQqIdentify('QQBot access-token', 1 << 25))).toEqual({
      op: 2,
      d: {
        token: 'QQBot access-token',
        intents: 33_554_432,
        shard: [0, 1],
        properties: { $os: 'desktop', $browser: 'MacroBay', $device: 'MacroBay' }
      }
    })
    expect(JSON.parse(buildQqResume('QQBot access-token', 'session-1', 1_337))).toEqual({
      op: 6,
      d: { token: 'QQBot access-token', session_id: 'session-1', seq: 1_337 }
    })
    expect(JSON.parse(buildQqHeartbeat(251))).toEqual({ op: 1, d: 251 })
    expect(JSON.parse(buildQqHeartbeat(null))).toEqual({ op: 1, d: null })
  })
})
