import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const readShell = (file: string): string =>
  readFileSync(resolve(process.cwd(), 'apps/desktop-shell/src/renderer/src/shell', file), 'utf8')

describe('preferences settings boundary', () => {
  it('does not expose assistant topic naming controls in basic settings', () => {
    // 基础设置面板的正文在 `AppShellSettingsLayout.tsx`（2026-11-09 从 AppShell 原样搬出）。
    const source = readShell('AppShell.tsx') + readShell('AppShellSettingsLayout.tsx')

    expect(source).not.toContain('t.preferences.assistantPlatform')
    expect(source).not.toContain('t.preferences.topicNaming')
    expect(source).not.toContain('settings.assistant.topicNaming')
  })

  it('shows the display-time-zone control in basic settings, wired to the setting and the i18n registry', () => {
    const source = readShell('AppShell.tsx')
    const preferencesPane = readShell('AppShellPreferencesPane.tsx')
    // 时间显示必须可设置：时区控件与语言/主题并列，文案来自 platformText（不得写死字符串）。
    expect(preferencesPane).toContain('<TimeZonePreference')
    expect(preferencesPane).toContain('value={settings.timeZone}')
    expect(preferencesPane).toContain('updateSettings({ timeZone: value })')
    // 偏好写入后的对账**已搬到 Main**（PLAT-32/S1）。PLAT-36 清掉了渲染侧残留：`settings.update` 成功路径
    // 由 Main 显式 `notifyPreferencesChanged()`，渲染侧不得再单飞一次受控读取（否则每次语言/主题/时区切换
    // 都多一条无产出的 IPC）。断言守护「只有一个对账点」这个当前事实 —— 两条边都看。
    // handler 已搬到 ipc/settingsIpc.ts：断言跟着实现走，不再读 app.ts 的文本。
    const mainSource = readFileSync(resolve(process.cwd(), 'platform/desktop/main/ipc/settingsIpc.ts'), 'utf8')
    const settingsUpdateStart = mainSource.indexOf('ipcMain.handle(IpcChannels.settingsUpdate')
    expect(settingsUpdateStart).toBeGreaterThan(-1)
    const settingsUpdateHandler = mainSource.slice(settingsUpdateStart)
    const nextHandlerStart = settingsUpdateHandler.indexOf('ipcMain.handle(', 'ipcMain.handle('.length)
    expect(settingsUpdateHandler.slice(0, nextHandlerStart)).toContain('notifyPreferencesChanged()')
    expect(source).not.toContain('broadcastWorkspacePreferenceChange')
    const updateSettingsStart = source.indexOf('async function updateSettings')
    expect(updateSettingsStart).toBeGreaterThan(-1)
    const updateSettingsBody = source.slice(updateSettingsStart, source.indexOf('\n  }', updateSettingsStart))
    expect(updateSettingsBody).toContain('window.platform.settings.update(patch)')
    expect(updateSettingsBody).not.toContain('getHostContext')
  })
})
