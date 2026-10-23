import { describe, expect, it } from 'vitest'

import { platformText } from '../../i18n/platformText'
import { resolveProviderDisplayName } from './providerDisplayName'

/** PLAT-62：只有中文原生站收录 providerNames；英文站保留原名。 */
const zh = platformText['zh-CN'].models
const en = platformText['en-US'].models

function provider(id: string, name: string): { id: string; name: string } {
  return { id, name }
}

describe('PLAT-62 provider display names', () => {
  it('keeps zh/en key sets identical and only for native Chinese sites', () => {
    expect(Object.keys(zh.providerNames).sort()).toEqual(Object.keys(en.providerNames).sort())
    expect(Object.keys(zh.providerNames)).toHaveLength(19)
    expect(zh.providerNames.zai).toBeUndefined()
    expect(zh.providerNames['minimax-global']).toBeUndefined()
    // 归属写进显示名：LongCat 是美团的、TokenHub 是腾讯云的。
    expect(zh.providerNames.longcat).toBe('美团 LongCat')
    expect(zh.providerNames.tokenhub).toBe('腾讯云 TokenHub')
  })

  it('resolves zh names and falls back for unlisted brands', () => {
    expect(resolveProviderDisplayName(zh, provider('silicon', 'Silicon'))).toBe('硅基流动')
    expect(resolveProviderDisplayName(zh, provider('dashscope', 'Bailian'))).toBe('阿里云百炼')
    expect(resolveProviderDisplayName(zh, provider('doubao', 'doubao'))).toBe('火山方舟 · 豆包')
    expect(resolveProviderDisplayName(zh, provider('mimo', 'Xiaomi MiMo'))).toBe('小米 MiMo')
    expect(resolveProviderDisplayName(zh, provider('zai', 'Z.ai'))).toBe('Z.ai')
    expect(resolveProviderDisplayName(zh, provider('minimax-global', 'MiniMax Global'))).toBe('MiniMax Global')
    expect(resolveProviderDisplayName(zh, provider('longcat', 'LongCat'))).toBe('美团 LongCat')
    expect(resolveProviderDisplayName(zh, provider('tokenrhythm', 'TokenRhythm'))).toBe('基元律动')
    expect(resolveProviderDisplayName(zh, provider('openai', 'OpenAI'))).toBe('OpenAI')
    expect(resolveProviderDisplayName(zh, provider('anthropic', 'Anthropic'))).toBe('Anthropic')
  })

  it('resolves English names for the same keys', () => {
    expect(resolveProviderDisplayName(en, provider('silicon', 'Silicon'))).toBe('SiliconFlow')
    expect(resolveProviderDisplayName(en, provider('lanyun', 'LANYUN'))).toBe('Lanyun')
    expect(resolveProviderDisplayName(en, provider('tokenrhythm', 'TokenRhythm'))).toBe('TokenRhythm')
    expect(resolveProviderDisplayName(en, provider('openai', 'OpenAI'))).toBe('OpenAI')
  })
})
