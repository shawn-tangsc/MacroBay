import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import { registerChannelAdapters } from './registerChannelAdapters'

describe('registerChannelAdapters', () => {
  it('registers concrete host factories except the permanently unreachable legacy WeChat path', () => {
    const register = vi.fn()

    registerChannelAdapters({ register })

    expect(register.mock.calls.map(([type]) => type)).toEqual([
      'telegram',
      'slack',
      'feishu',
      'qq',
      'discord'
    ])
    expect(register.mock.calls.every(([, factory]) => typeof factory === 'function')).toBe(true)
    const source = readFileSync(resolve(__dirname, 'registerChannelAdapters.ts'), 'utf8')
    expect(source).not.toContain("./wechat/createWeChatChannelHost")
    expect(source).not.toContain("register('wechat'")
  })
})
