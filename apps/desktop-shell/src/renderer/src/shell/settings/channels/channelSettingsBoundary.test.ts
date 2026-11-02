import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../../..')
const page = readFileSync(resolve(root, 'shell/settings/channels/ChannelSettingsPage.tsx'), 'utf8')
const presentation = readFileSync(
  resolve(root, 'shell/settings/channels/channelSettingsPresentation.ts'),
  'utf8'
)
const handoff = readFileSync(resolve(root, 'shell/settings/channels/secureCredentialHandoff.ts'), 'utf8')
const navigation = readFileSync(resolve(root, 'shell/navigation/builtInNavEntries.ts'), 'utf8')

describe('channel settings boundary', () => {
  it('keeps the panel registered and credential transport in WebCrypto', () => {
    expect(navigation).toContain("id: 'channels'")
    expect(page).toContain('clearSensitiveDraft(setCredentialDraft)')
    expect(page).toContain('clearSensitiveDraft(setAppCredentialDraft)')
    expect(page).toContain('clearSensitiveDraft(setPolicyDraft)')
    expect(page).toContain('window.platform.agents.listAgents')
    expect(page).toContain('window.platform.channels.update')
    expect(page).toContain('channelEnableBlocked')
    // Every adapter states what it is missing; a blocked row is never just "blocked", and no
    // adapter is hidden from the catalog list.
    // 文案表与「缺什么」的推理被抽到同目录的呈现层（页面顶到 500 行硬线），断言跟着过去，
    // 判据不变：每个适配器都必须能给出一句缺什么。
    expect(presentation).toContain('catalogReason(')
    expect(presentation).toContain('channelCatalogReason')
    expect(page).toContain('{catalog.map((entry) => (')
    expect(page).not.toContain("entry.type !== 'telegram'")
    // 六家适配器的类型联合跟着类型定义进了呈现层；页面仍以同一联合作为创建类型。
    expect(presentation).toContain("type: 'telegram' | 'slack' | 'feishu' | 'qq' | 'discord' | 'wechat'")
    expect(page).toContain("'telegram' | 'slack' | 'feishu' | 'qq' | 'discord' | 'wechat'")
    expect(page).toContain('channelAppCredential')
    expect(page).toContain('channelLarkAppSecret')
    expect(page).toContain('channelQqClientSecret')
    expect(page).toContain('channelDiscordBotToken')
    expect(page).toContain('channelWechatEnrollment')
    expect(page).toContain("current.type !== 'wechat' ? <section>")
    expect((page.match(/current\.type !== 'wechat' \? <section>/g) ?? []).length).toBe(2)
    expect(page).toContain('window.platform.channels')
    expect(page).not.toContain('localStorage')
    expect(page).not.toMatch(/require\(|from ['"]node:|ipcRenderer/)
    expect(handoff).toContain("name: 'ECDH'")
    expect(handoff).toContain("name: 'AES-GCM'")
    expect(handoff).not.toContain('ipcRenderer')
    expect(handoff).not.toMatch(/node:|localStorage/)
  })
})
