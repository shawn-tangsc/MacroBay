import { describe, expect, it } from 'vitest'

import {
  modelChatProtocols,
  normalizeModelChatProtocol,
  resolveModelChatProtocol
} from './modelChatProtocol'
import type { ProviderChatEndpoint } from './modelProviderTypes'

/**
 * T4/T5：模型级聊天协议解析（四种协议平权，没有硬编码默认协议）。
 * - 协议是**模型自己的事实**（同步/新增时写入），运行时不再跟随供应商默认；
 * - 模型没有协议 ⇒ endpoint_missing（绝不静默回落到某个协议）；
 * - 该协议必须在供应商 `endpoints` 里且**地址非空**，否则同样 endpoint_missing（不发请求）。
 */
const endpoints = (...entries: ProviderChatEndpoint[]): ProviderChatEndpoint[] => entries

describe('normalizeModelChatProtocol', () => {
  it('accepts only the known protocols', () => {
    expect(modelChatProtocols).toEqual(['chat-completions', 'responses', 'gemini', 'messages'])
    expect(normalizeModelChatProtocol('chat-completions')).toBe('chat-completions')
    expect(normalizeModelChatProtocol('responses')).toBe('responses')
    expect(normalizeModelChatProtocol('gemini')).toBe('gemini')
    // PLAT-69：Anthropic Messages（`/v1/messages`）也是可选的聊天协议。
    expect(normalizeModelChatProtocol('messages')).toBe('messages')
  })

  it('drops unknown or malformed values instead of guessing', () => {
    for (const value of ['anthropic', 'Messages', 'Responses', '', ' ', null, undefined, 42, {}, []]) {
      expect(normalizeModelChatProtocol(value)).toBeUndefined()
    }
  })
})

describe('resolveModelChatProtocol', () => {
  it('refuses to guess when the model has no protocol', () => {
    expect(resolveModelChatProtocol({})).toEqual({ ok: false, reasonCode: 'endpoint_missing' })
    expect(resolveModelChatProtocol({ endpoints: endpoints() })).toEqual({
      ok: false,
      reasonCode: 'endpoint_missing'
    })
    expect(resolveModelChatProtocol({
      endpoints: endpoints({ protocol: 'responses', baseUrl: 'https://x.test' })
    })).toEqual({ ok: false, reasonCode: 'endpoint_missing' })
  })

  it('keeps chat-completions available even with other endpoints configured', () => {
    expect(
      resolveModelChatProtocol({
        protocol: 'chat-completions',
        endpoints: endpoints(
          { protocol: 'chat-completions', baseUrl: 'https://api.test' },
          { protocol: 'responses', baseUrl: 'https://api.test' },
          { protocol: 'gemini', baseUrl: 'https://api.test' }
        )
      })
    ).toEqual({ ok: true, protocol: 'chat-completions' })
  })

  it('requires the matching endpoint for responses and gemini', () => {
    expect(resolveModelChatProtocol({ protocol: 'responses' })).toEqual({
      ok: false,
      reasonCode: 'endpoint_missing'
    })
    expect(resolveModelChatProtocol({
      protocol: 'responses',
      endpoints: endpoints({ protocol: 'gemini', baseUrl: 'https://x.test' })
    })).toEqual({ ok: false, reasonCode: 'endpoint_missing' })
    // 已声明但没配地址（空串）⇒ 不可用。
    expect(resolveModelChatProtocol({
      protocol: 'responses',
      endpoints: endpoints({ protocol: 'responses', baseUrl: '  ' })
    })).toEqual({ ok: false, reasonCode: 'endpoint_missing' })
    expect(resolveModelChatProtocol({
      protocol: 'responses',
      endpoints: endpoints({ protocol: 'responses', baseUrl: 'https://x.test' })
    })).toEqual({ ok: true, protocol: 'responses' })

    expect(resolveModelChatProtocol({
      protocol: 'gemini',
      endpoints: endpoints({ protocol: 'gemini', baseUrl: '' })
    })).toEqual({ ok: false, reasonCode: 'endpoint_missing' })
    expect(resolveModelChatProtocol({
      protocol: 'gemini',
      endpoints: endpoints({ protocol: 'gemini', baseUrl: 'https://x.test' })
    })).toEqual({ ok: true, protocol: 'gemini' })
  })

  /** PLAT-69：`messages` 端点就是 Anthropic Messages 的 base；没配地址时必须在发请求前拒绝。 */
  it('requires a configured messages endpoint for the messages protocol', () => {
    expect(resolveModelChatProtocol({ protocol: 'messages' })).toEqual({ ok: false, reasonCode: 'endpoint_missing' })
    expect(resolveModelChatProtocol({
      protocol: 'messages',
      endpoints: endpoints({ protocol: 'gemini', baseUrl: 'https://x.test' })
    })).toEqual({ ok: false, reasonCode: 'endpoint_missing' })
    expect(resolveModelChatProtocol({
      protocol: 'messages',
      endpoints: endpoints({ protocol: 'messages', baseUrl: 'https://x.test' })
    })).toEqual({ ok: true, protocol: 'messages' })
    expect(resolveModelChatProtocol({
      protocol: 'messages',
      endpoints: endpoints({ protocol: 'messages', baseUrl: '   ' })
    })).toEqual({ ok: false, reasonCode: 'endpoint_missing' })
  })
})
