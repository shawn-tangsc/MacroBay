import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * 2026-11-01 裁决：强调色「不接、入口撤掉」。
 *
 * 字段与根属性保留（存储不迁移、两个窗口的属性组逐字不变），但**设置页不许再出现入口**。
 * 真接通（令牌派生 accent 系列 + 组件库主色跟随）要另立一项，不从「顺手加个入口」开始。
 *
 * 这里故意用源码级守卫而不是渲染断言：渲染断言只能证明「当前这套文案下没渲染出来」，
 * 有人换了文案再加回来它就悄悄失效；钉住「偏好段不许提到强调色」才是可证伪的。
 */
const REPO_ROOT = resolve(__dirname, '../../../../../..')
const SHELL_FILE = resolve(__dirname, 'AppShell.tsx')
const SCHEMA_FILE = resolve(REPO_ROOT, 'platform/settings/schema/appSettings.ts')

function preferencesSection(): string {
  const source = readFileSync(SHELL_FILE, 'utf8')
  const start = source.indexOf('function renderPreferences()')
  const end = source.indexOf('function renderNotifications()')
  if (start < 0 || end <= start) throw new Error('renderPreferences 的边界变了，守卫要跟着改')
  return source.slice(start, end)
}

describe('基础设置不再暴露强调色入口', () => {
  it('偏好段不渲染任何强调色控件', () => {
    const section = preferencesSection()
    expect(section).not.toMatch(/accentColor/i)
    expect(section).not.toMatch(/\b(lime|cyan|violet)\b/i)
  })

  it('字段与根属性保留，字段处写明「没有任何样式按它取值」', () => {
    const schema = readFileSync(SCHEMA_FILE, 'utf8')
    expect(schema).toMatch(/accentColor: AccentColor/)
    expect(schema).toContain('没有任何样式按它取值')
    const shell = readFileSync(SHELL_FILE, 'utf8')
    expect(shell).toContain('toThemeAttributes(settings.themeMode, settings.accentColor')
  })
})
