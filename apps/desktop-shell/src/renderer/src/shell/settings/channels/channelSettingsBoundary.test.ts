import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../../..')
const read = (relativePath: string): string => readFileSync(resolve(root, relativePath), 'utf8')

const page = read('shell/settings/channels/ChannelSettingsPage.tsx')
// 页面级动作（停用/删除、启用自检、发测试消息、选文件夹、凭据回读）抽到了这个模块：
// 它们仍然只是「过 preload 桥」的调用，边界判据必须连着它一起看，否则守卫会因为搬家而假绿。
const actions = read('shell/settings/channels/channelSettingsActions.ts')
const row = read('shell/settings/channels/ChannelRow.tsx')
const createDialog = read('shell/settings/channels/ChannelCreateDialog.tsx')
const handoff = read('shell/settings/channels/secureCredentialHandoff.ts')
const navigation = read('shell/navigation/builtInNavEntries.ts')

/**
 * 频道设置页的边界守卫（改版后按 A 原型重写）。
 *
 * 改的是文件布局，不是判据：凭据只能走 WebCrypto 交接、页面不直接摸 localStorage / ipcRenderer、
 * Token 在列表里永远只是掩码、导航项仍在。旧断言盯的是被删掉的详情面板，跟着布局一起换了位置。
 */
describe('channel settings boundary', () => {
  it('keeps the panel registered and all channel IO behind the preload bridge', () => {
    expect(navigation).toContain("id: 'channels'")
    for (const call of [
      'window.platform.channels.catalog',
      'window.platform.channels.list',
      'window.platform.channels.create',
      'window.platform.channels.update',
      'window.platform.channels.disable',
      'window.platform.channels.remove',
      'window.platform.agents.listAgents'
    ]) {
      expect(page).toContain(call)
    }
    for (const call of [
      'window.platform.channels.requestEnable',
      'window.platform.channels.sendTestMessage',
      'window.platform.channels.get',
      'window.platform.app.selectDirectory',
      'window.platform.agents.ensureWorkspace'
    ]) {
      expect(actions).toContain(call)
    }
    for (const source of [page, actions, row, createDialog]) {
      expect(source).not.toContain('localStorage')
      expect(source).not.toMatch(/require\(|from ['"]node:|ipcRenderer/)
      expect(source).not.toMatch(/from ['"]@products\//)
    }
  })

  it('sends the token through the encrypted handoff and clears the draft afterwards', () => {
    // 草稿清空的具体形状（清一个 state 还是清整个表单）不锁，锁的是「提交后立刻清」这件事本身。
    expect(createDialog).toContain('clearSensitiveDraft(')
    expect(createDialog).toContain('encryptChannelHandoff')
    expect(createDialog).toContain('window.platform.channels.beginCredential')
    expect(createDialog).toContain('window.platform.channels.submitCredential')
    expect(handoff).toContain("name: 'ECDH'")
    expect(handoff).toContain("name: 'AES-GCM'")
    expect(handoff).not.toContain('ipcRenderer')
    expect(handoff).not.toMatch(/node:|localStorage/)
  })

  it('renders the token as a mask only — the row has no reveal or copy entry', () => {
    expect(row).toContain('channelTokenMask')
    expect(row).not.toContain('channelReveal')
    expect(row).not.toContain('channelCopy')
    // 掩码来自文案表，不是把真值截一段：页面里没有任何 token 切片。
    expect(row).not.toMatch(/token\s*\.\s*slice|slice\(0, 6\)/)
  })
})
