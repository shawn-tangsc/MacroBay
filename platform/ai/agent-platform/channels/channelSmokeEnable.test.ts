import { describe, expect, it, vi } from 'vitest'

import { createChannelSmokeRouter } from './channelSmokeEnable'

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
