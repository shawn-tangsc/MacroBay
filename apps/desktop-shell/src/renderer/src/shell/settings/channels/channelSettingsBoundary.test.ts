import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../../..')
const page = readFileSync(resolve(root, 'shell/settings/channels/ChannelSettingsPage.tsx'), 'utf8')
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
    expect(page).toContain("type: 'telegram' | 'slack' | 'feishu' | 'qq' | 'discord' | 'wechat'")
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
