import { describe, expect, it } from 'vitest'

import { parseDiscordGatewayFrame } from './DiscordGatewayProtocol'

/**
 * Discord Gateway 的**帧解析**（官方文档：Discord Developers › Docs › Topical › Gateway，
 * "Payload Structure" 与 "Opcodes/Status Codes" 两节）。
 *
 * 这一层只回答「这一帧是什么」，不碰连接：心跳由下一层按 `hello` 给的间隔发。判据是
 * **坏帧一律返回 null**，让上层记一条 `discord-dispatch-invalid`，不许猜着当成消息。
 */
describe('discord gateway frame parsing', () => {
  it('reads HELLO and the heartbeat interval it carries', () => {
    expect(parseDiscordGatewayFrame('{"op":10,"d":{"heartbeat_interval":41250}}')).toEqual({
      kind: 'hello',
      heartbeatIntervalMs: 41250
    })
    // 间隔必须是正有限数，否则上层无法排心跳。
    expect(parseDiscordGatewayFrame('{"op":10,"d":{"heartbeat_interval":0}}')).toBeNull()
    expect(parseDiscordGatewayFrame('{"op":10,"d":{}}')).toBeNull()
  })

  it('reads the heartbeat request, the ACK, reconnect and invalid session', () => {
    expect(parseDiscordGatewayFrame('{"op":1,"d":42}')).toEqual({ kind: 'heartbeat', sequence: 42 })
    expect(parseDiscordGatewayFrame('{"op":1,"d":null}')).toEqual({ kind: 'heartbeat', sequence: null })
    expect(parseDiscordGatewayFrame('{"op":11,"d":null}')).toEqual({ kind: 'heartbeat-ack' })
    expect(parseDiscordGatewayFrame('{"op":7,"d":null}')).toEqual({ kind: 'reconnect' })
    expect(parseDiscordGatewayFrame('{"op":9,"d":true}')).toEqual({ kind: 'invalid-session', resumable: true })
    expect(parseDiscordGatewayFrame('{"op":9,"d":false}')).toEqual({ kind: 'invalid-session', resumable: false })
  })

  it('reads a dispatch with its event name and sequence number', () => {
    expect(parseDiscordGatewayFrame('{"op":0,"s":41,"t":"MESSAGE_CREATE","d":{"id":"1"}}')).toEqual({
      kind: 'dispatch',
      event: 'MESSAGE_CREATE',
      sequence: 41,
      data: { id: '1' }
    })
  })

  it('rejects malformed frames instead of guessing', () => {
    for (const raw of ['', 'not-json', '{}', '[]', 'null', '{"op":"0"}', '{"op":0,"t":""}', '{"op":0,"t":"MESSAGE_CREATE"}', '{"op":0,"s":-1,"t":"MESSAGE_CREATE"}', '{"op":9,"d":"yes"}']) {
      expect(parseDiscordGatewayFrame(raw), raw).toBeNull()
    }
    // 超大帧直接拒绝：网关单帧不该到这个尺寸，读下来只是内存风险。
    expect(parseDiscordGatewayFrame(`{"op":11,"d":null,"pad":"${'x'.repeat(1_000_001)}"}`)).toBeNull()
  })

  it('keeps an unknown opcode visible instead of dropping it', () => {
    expect(parseDiscordGatewayFrame('{"op":5,"d":null}')).toEqual({ kind: 'unknown', op: 5 })
  })
})
