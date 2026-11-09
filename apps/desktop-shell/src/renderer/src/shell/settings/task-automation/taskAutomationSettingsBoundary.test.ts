import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('task automation settings boundary', () => {
  it('composes task automation as a built-in platform panel without product registration', () => {
    // 设置面板的接线在 `AppShellSettingsLayout.tsx`（2026-11-09 从 AppShell 原样搬出）；判据不变。
    const appShell = readFileSync(resolve(process.cwd(), 'apps/desktop-shell/src/renderer/src/shell/AppShellSettingsLayout.tsx'), 'utf8')
    const navigation = readFileSync(resolve(process.cwd(), 'apps/desktop-shell/src/renderer/src/shell/navigation/builtInNavEntries.ts'), 'utf8')

    expect(appShell).toContain("TaskAutomationSettingsPage")
    expect(appShell).toContain("settingsPanelKey === 'task-automation'")
    expect(navigation).toContain("id: 'task-automation'")
    expect(appShell).not.toMatch(/@products\/(?!generated\/)/)
  })
})
