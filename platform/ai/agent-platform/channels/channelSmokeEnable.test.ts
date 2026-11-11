import { describe, expect, it, vi } from 'vitest'

import { createChannelSmokeRouter, requestSmokeEnabledChannel } from './channelSmokeEnable'

/**
 * 自检路由的判据：**挂上谁由显式表决定，没挂的一律「未支持」**。
 *
 * 这条用例存在的理由很具体：启用链的 smoke 曾经只有 telegram 一条被接进组合根，
 * 代码看上去一切正常，别家点启用却只能得到「适配器未支持」——而真正的信号是「这家的自检没写」。
 */
describe('channel smoke router', () => {
  it('sends each adapter type to its own check', async () => {
    const telegram = vi.fn(async () => ({ ok: true as const }))
    const slack = vi.fn(async () => ({ ok: true as const }))
    const smoke = createChannelSmokeRouter({ telegram, slack })

    await expect(smoke({ id: 'a', type: 'telegram' })).resolves.toEqual({ ok: true })
    await expect(smoke({ id: 'b', type: 'slack' })).resolves.toEqual({ ok: true })
    expect(telegram).toHaveBeenCalledWith({ id: 'a', type: 'telegram' })
    expect(slack).toHaveBeenCalledWith({ id: 'b', type: 'slack' })
  })

  it('refuses to pass an adapter whose check does not exist', async () => {
    const smoke = createChannelSmokeRouter({ telegram: async () => ({ ok: true }) })
    for (const type of ['feishu', 'qq', 'discord', 'wechat'] as const) {
      await expect(smoke({ id: 'c', type })).resolves.toEqual({ ok: false, code: 'adapter-not-supported' })
    }
  })
})


/**
 * 自检**抛异常**（超时、解密失败、没有捕获的 fetch 错）时的说法：必须按这一条通道的适配器归一。
 * 以前这里硬编码 `telegram-network-unavailable`——飞书失败会被 Telegram 的网络话术解释，
 * 读者拿着错话术去排查别的东西。
 */
describe('a self-check that throws speaks the same adapter as the channel', () => {
  const channel = (type: string) => ({ id: 'c1', type } as never)

  async function reasonFor(type: string): Promise<string> {
    const audits: string[] = []
    const result = await requestSmokeEnabledChannel(
      {
        smoke: async () => { throw new Error('boom') },
        audit: (code) => audits.push(code),
        enable: async () => ({ ok: true, code: 'runtime-ready' })
      },
      { channel: channel(type) }
    )
    expect(audits).toHaveLength(1)
    expect(result.ok).toBe(false)
    return audits[0]!
  }

  it('never explains a Lark failure with the Telegram wording', async () => {
    const reason = await reasonFor('feishu')
    expect(reason).toBe('lark-network-unavailable')
    expect(reason).not.toContain('telegram')
  })

  it('keeps each other adapter on its own wording too', async () => {
    expect(await reasonFor('slack')).toBe('slack-network-unavailable')
    expect(await reasonFor('discord')).toBe('discord-network-unavailable')
    expect(await reasonFor('qq')).toBe('qq-network-unavailable')
    expect(await reasonFor('telegram')).toBe('telegram-network-unavailable')
  })
})
