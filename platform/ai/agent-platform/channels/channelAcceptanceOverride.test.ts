import { afterEach, describe, expect, it } from 'vitest'

import {
  acceptanceOverrideSql,
  channelAcceptanceOverrides,
  releaseChannelAcceptance,
  retainChannelAcceptance,
  setChannelAcceptanceOverride
} from './channelAcceptanceOverride'

/**
 * 放行按**适配器键**记，而调用点拿到的是**存储类型**。飞书是唯一两者不同的适配器
 * （类型 `feishu` / 键 `lark`），少这一步映射，放行会静默失败，启用最后一跳就判「平台没接上」。
 */
afterEach(() => setChannelAcceptanceOverride(null))

describe('acceptance override keys', () => {
  it('retains the adapter key the database actually stores for a feishu channel', () => {
    expect(retainChannelAcceptance('feishu')).toBe('lark')
    expect(channelAcceptanceOverrides()).toEqual(['lark'])
    // 支持判定拿这段 SQL 去比 `agent_channels.adapter_key`（飞书行是 'lark'）。
    expect(acceptanceOverrideSql('adapter_key')).toContain("'lark'")
  })

  it('releases by the same storage type', () => {
    retainChannelAcceptance('feishu')
    releaseChannelAcceptance('feishu')
    expect(channelAcceptanceOverrides()).toEqual([])
  })

  it('keeps unknown values out instead of guessing', () => {
    expect(retainChannelAcceptance('sample-unknown')).toBeNull()
    expect(channelAcceptanceOverrides()).toEqual([])
  })
})
