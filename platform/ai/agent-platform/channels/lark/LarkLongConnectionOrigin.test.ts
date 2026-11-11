import { describe, expect, it, vi } from 'vitest'

/**
 * 飞书两跳的域名**必须只有一个来源**。
 *
 * 背景：REST 打 `open.larksuite.com`，而长连接取 wss 地址那一跳（会把 `app_id + app_secret` 放进请求体）
 * 由 SDK 默认打 `open.feishu.cn`。承诺「凭据不越过 Feishu origin」与代码互相打脸，而且改域名要改两处。
 *
 * 这条用例钉两件事：
 * 1. SDK 构造时收到的 `domain` 就是 `LarkContracts.larkOrigin`（不是 SDK 默认值）；
 * 2. REST 基址从同一个常量派生。
 *
 * 把常量改成 `https://open.feishu.cn` 时，两边**同时**变成 feishu——这正是「只有一个来源」的证明。
 */
const { sdkOptions } = vi.hoisted(() => ({ sdkOptions: [] as Array<Record<string, unknown>> }))

vi.mock('@larksuiteoapi/node-sdk', () => ({
  WSClient: class {
    constructor(options: Record<string, unknown>) {
      sdkOptions.push(options)
    }

    start(): Promise<void> {
      return Promise.resolve()
    }

    close(): void {}
  },
  EventDispatcher: class {
    register(): void {}
  }
}))

import { larkApiBase, larkOrigin } from './LarkContracts'
import { createLarkLongConnection } from './LarkLongConnectionClient'

describe('lark origin', () => {
  it('feeds the REST base and the wss address request from the same constant', async () => {
    const connection = createLarkLongConnection({
      appId: 'cli_0123456789abcdef',
      appSecret: 'app-secret-value',
      resolveProxy: async () => ({ kind: 'direct' }),
      getPlatformFetch: () => (async () => new Response('{}')) as typeof fetch
    })
    await expect(connection.connect({ onEvent: () => {} })).resolves.toEqual({ ok: true })

    expect(sdkOptions).toHaveLength(1)
    // SDK 的 domain 位：不传就是它自己的默认（Feishu），传了才跟 REST 同源。
    expect(sdkOptions[0]?.domain).toBe(larkOrigin)
    expect(new URL(larkApiBase).origin).toBe(larkOrigin)
    expect(larkApiBase).toBe(`${larkOrigin}/open-apis`)
  })
})