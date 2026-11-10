import { describe, expect, it } from 'vitest'

import { createInitialChannelAdapterAcceptanceEntries } from './ChannelAdapterAcceptanceRegistry'
import { channelAdapterDescriptor, channelAdapterDescriptors } from './channelAdapterDescriptors'
import { projectChannelCatalog } from './channelCatalogProjection'

/**
 * 「列表里出现它」的判据落在两处，缺一个都不算接上：
 * 1. `channelAdapterDescriptors.implemented` —— 适配器本身真的接上了；
 * 2. 目录投影把这一位原样带出去 —— 设置页的列表按它筛，不看手写名单。
 *
 * 这条用例存在的理由：启用链曾经只有 telegram 一条被接进组合根，列表也据此手写，
 * 代码看上去一切正常，别家点启用却只能得到「未支持」。
 */
describe('channel adapter catalogue', () => {
  it('says Discord, QQ and Lark are implemented and leaves WeChat honest', () => {
    expect(channelAdapterDescriptor('discord').implemented).toBe(true)
    expect(channelAdapterDescriptor('telegram').implemented).toBe(true)
    expect(channelAdapterDescriptor('slack').implemented).toBe(true)
    expect(channelAdapterDescriptor('qq').implemented).toBe(true)
    expect(channelAdapterDescriptor('lark').implemented).toBe(true)
    // 微信没有入站通路：不许提前说「能开」。
    for (const key of ['wechat'] as const) {
      expect(channelAdapterDescriptors[key].implemented, key).toBe(false)
    }
  })

  it('carries that flag into the catalogue the settings list filters on', () => {
    const catalog = projectChannelCatalog(createInitialChannelAdapterAcceptanceEntries())
    expect(catalog.find((entry) => entry.type === 'discord')).toMatchObject({
      implemented: true,
      credentialFields: ['bot_token']
    })
    expect(catalog.find((entry) => entry.type === 'qq')).toMatchObject({
      implemented: true,
      credentialFields: ['app_id', 'client_secret']
    })
    expect(catalog.find((entry) => entry.type === 'feishu')).toMatchObject({
      implemented: true,
      credentialFields: ['app_id', 'app_secret']
    })
  })
})
