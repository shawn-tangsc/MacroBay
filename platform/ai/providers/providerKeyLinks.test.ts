import { describe, expect, it } from 'vitest'

import { createSystemProviderPresets, resolveProviderKeyUrl } from './providerPresets'
import { PROVIDER_REFERRAL_LINKS } from './providerReferralPrograms'

/**
 * 「获取密钥」入口守卫（用户抱怨的重点：设置页没有入口）。
 *
 * 三条口径：
 *  1. **云端供应商必须有入口**：`websites.apiKey` 是设置页「点击这里获取密钥」的唯一来源，
 *     缺一家就少一个入口，所以这里逐家点名，失败时直接看得到是哪几家。
 *  2. **本地 / CLI 类没有 key 页**：key 由本机运行时提供（或根本没有这个概念），
 *     把它们列进白名单；白名单与「实际没有 apiKey 的家」必须**完全一致** ——
 *     既防止云端漏配，也防止某一家被悄悄加成"不需要 key"。
 *  3. **指向具体 key 页而不是官网首页**：`apiKey` 与 `official` 相同等于没有入口
 *     （例如 poe 的官网是 `https://poe.com/`，key 页必须写 `https://poe.com/api/keys`）。
 *
 * 数据来源：各供应商官方文档与控制台路由；`website.apiKey` 是本地维护的
 * 稳定入口，不依赖第三方清单。我们自己的邀请链接优先（`providerReferralPrograms.ts`），
 * 官方只给站点根的少数供应商在各自预设文件里用行内注释写明人工映射依据。
 */
const KEYLESS_LOCAL_OR_CLI_IDS = ['ovms', 'ollama', 'lmstudio', 'gpustack', 'new-api'] as const

const HTTP_URL = /^https?:\/\/[^\s]+$/

const presets = createSystemProviderPresets()

/** 去尾斜杠后比较，避免 `https://x.com/` 与 `https://x.com` 被当成两个页面。 */
function normalized(url: string | undefined): string {
  return (url ?? '').trim().replace(/\/+$/, '')
}

describe('provider 「获取密钥」入口', () => {
  it('every cloud provider ships an http(s) websites.apiKey', () => {
    const offenders = presets
      .filter((preset) => !(KEYLESS_LOCAL_OR_CLI_IDS as readonly string[]).includes(preset.id))
      .filter((preset) => !HTTP_URL.test(preset.websites?.apiKey ?? ''))
      .map((preset) => `${preset.id}: ${preset.websites?.apiKey ?? '(missing)'}`)

    expect(offenders).toEqual([])
  })

  it('keeps exactly the local/CLI whitelist keyless', () => {
    const keyless = presets.filter((preset) => !preset.websites?.apiKey).map((preset) => preset.id)
    // 顺序 = 预设顺序；白名单里有幽灵 id 或多出一家云端都会让这一行红。
    expect(keyless).toEqual([...KEYLESS_LOCAL_OR_CLI_IDS])
  })

  it('points apiKey at a key page instead of the site root', () => {
    const offenders = presets
      .filter((preset) => normalized(preset.websites?.apiKey) === normalized(preset.websites?.official))
      .map((preset) => preset.id)

    expect(offenders).toEqual([])
  })
})

/**
 * 有我们自己的邀请链接的 11 家：`PROVIDER_REFERRAL_LINKS` 覆盖 10 家，
 * aihubmix 的邀请链接（`?aff=`）直接写在预设 `websites.apiKey` 里。
 */
const INVITE_LINKED_IDS = [
  'silicon',
  'zai',
  'mimo',
  'aionly',
  'tokenrhythm',
  'dashscope',
  'burncloud',
  'cephalon',
  'lanyun',
  'qiniu',
  'aihubmix'
] as const

describe('resolveProviderKeyUrl', () => {
  it('prefers our own invite link for every invite-linked provider', () => {
    for (const providerId of INVITE_LINKED_IDS) {
      const preset = presets.find((entry) => entry.id === providerId)
      expect(preset, providerId).toBeDefined()
      // 邀请链接优先：有就返回它，没有（aihubmix）就返回预设里带 aff 的 key 入口。
      expect(resolveProviderKeyUrl(providerId), providerId)
        .toBe(PROVIDER_REFERRAL_LINKS[providerId] ?? preset?.websites?.apiKey)
      // 这 11 家的 `apiKey` 本来就是邀请链接 ⇒ 任何"普通 key 页"都不能覆盖它。
      expect(resolveProviderKeyUrl(providerId), providerId).not.toBe(preset?.websites?.official)
    }
  })

  it('falls back to the preset key page for providers without an invite link', () => {
    for (const providerId of ['groq', 'openrouter', 'poe', 'ocoolai', 'doubao', 'hyperbolic']) {
      const preset = presets.find((entry) => entry.id === providerId)
      expect(resolveProviderKeyUrl(providerId), providerId).toBe(preset?.websites?.apiKey)
      expect(resolveProviderKeyUrl(providerId), providerId).toMatch(/^https:\/\//)
    }
  })

  it('lets an injected invite link win over the preset key page', () => {
    const groqKeyPage = presets.find((entry) => entry.id === 'groq')?.websites?.apiKey
    expect(groqKeyPage).toBe('https://console.groq.com/keys')
    // 码还没拿到时用注入验证优先级（也证明解析只是在"链接 → key 页"之间选择，不做字符串拼接）。
    expect(resolveProviderKeyUrl('groq', { groq: 'https://example.test/invite/CODE' }))
      .toBe('https://example.test/invite/CODE')
    expect(resolveProviderKeyUrl('groq', {})).toBe(groqKeyPage)
  })

  it('returns undefined for the local/CLI whitelist', () => {
    for (const providerId of KEYLESS_LOCAL_OR_CLI_IDS) {
      expect(resolveProviderKeyUrl(providerId), providerId).toBeUndefined()
    }
  })
})
