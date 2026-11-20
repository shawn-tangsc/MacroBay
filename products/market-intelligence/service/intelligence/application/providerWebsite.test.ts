import { describe, expect, it } from 'vitest'

import { providerRegistry } from './providerRegistry'

/**
 * 加源规范：**要密钥的源必须填官网**（用户 2026-11-13）。
 *
 * 「官网」按钮只按数据画——`website` 为空就整个不出现，读者打开这个源看不到它是什么站。
 * 这条把这个坑变成红灯：**新加一个 api-key 源却没有官网，就会在这里红**。
 *
 * 下面这份名单是**历史欠账**（不是白名单）：修好一个就把它从这里删掉，删掉不会让这条失败。
 * 只许变小、不许变大——新增一个缺官网的源，等于把欠账变成规范。
 */
const KNOWN_MISSING_WEBSITE = [
  'coinmarketcal',
  'cryptopanic',
  'fred',
  'realmarketapi',
  'twelve-data'
] as const

describe('provider website', () => {
  it('never lets a new keyed provider ship without a website', () => {
    const missing = providerRegistry
      .filter((provider) => provider.credential === 'api-key')
      .filter((provider) => provider.website === undefined || provider.website.trim() === '')
      .map((provider) => provider.providerId)
      .sort()
    const regressions = missing.filter((id) => !(KNOWN_MISSING_WEBSITE as readonly string[]).includes(id))
    expect(regressions, '新增的 api-key 源必须填官网地址，否则读者看不到「官网」按钮').toEqual([])
  })

  it('keeps the declared website a real absolute URL', () => {
    for (const provider of providerRegistry) {
      if (provider.website === undefined) continue
      expect(provider.website, provider.providerId).toMatch(/^https:\/\/[^\s]+$/)
    }
  })
})
