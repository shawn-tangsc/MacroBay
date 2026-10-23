import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { AppSettings, ThemeMode } from '@platform/settings/schema/appSettings'
import { createDefaultAppSettings } from '@platform/settings/schema/appSettings'
import { readWorkspaceContextTheme, readWorkspaceContextTimeZone, resolveWorkspaceContextTheme } from './panelWorkspaceRuntimePreferences'

/**
 * Owner: platform/desktop/main/workspace / P1-06h（N3）。回归：本文件。
 *
 * 真机症状（P1-07 记录项 N3）：app 设置 themeMode=dark 时，面板窗上下文 `preferences.theme` 仍报 light，
 * 因为它直接取 OS `nativeTheme.shouldUseDarkColors`，没有跟随 shell 使用的同一份设置（language 当时是对的）。
 * 本文件用**注入的 settings store** 固定「设置优先、只有 system 才看 OS」这条语义，不启动 Electron。
 */
function settingsStore(themeMode: ThemeMode, language: AppSettings['language'] = 'zh-CN') {
  let current: AppSettings = { ...createDefaultAppSettings(), themeMode, language }
  return {
    get: async () => current,
    setThemeMode: (next: ThemeMode) => { current = { ...current, themeMode: next } },
    setTimeZone: (next: AppSettings['timeZone']) => { current = { ...current, timeZone: next } }
  }
}

describe('resolveWorkspaceContextTheme：settings 优先，system 才回退 OS', () => {
  it('设置 dark/light 时一律以设置为准，OS 值不参与（N3 的核心回归）', () => {
    expect(resolveWorkspaceContextTheme('dark', false)).toBe('dark')
    expect(resolveWorkspaceContextTheme('dark', true)).toBe('dark')
    expect(resolveWorkspaceContextTheme('light', true)).toBe('light')
    expect(resolveWorkspaceContextTheme('light', false)).toBe('light')
  })

  it('只有 themeMode=system 时才回退 OS 偏好', () => {
    expect(resolveWorkspaceContextTheme('system', true)).toBe('dark')
    expect(resolveWorkspaceContextTheme('system', false)).toBe('light')
  })
})

describe('readWorkspaceContextTheme：与 shell 同一来源（注入的 settings store）', () => {
  it('app=dark 时即使 OS 报 light，上下文主题仍是 dark', async () => {
    const store = settingsStore('dark')
    await expect(readWorkspaceContextTheme(store, { shouldUseDarkColors: false })).resolves.toBe('dark')
  })

  it('app=light 时即使 OS 报 dark，上下文主题仍是 light', async () => {
    const store = settingsStore('light')
    await expect(readWorkspaceContextTheme(store, { shouldUseDarkColors: true })).resolves.toBe('light')
  })

  it('app=system 时按 OS 偏好解析（唯一的 nativeTheme 路径）', async () => {
    const store = settingsStore('system')
    await expect(readWorkspaceContextTheme(store, { shouldUseDarkColors: true })).resolves.toBe('dark')
    await expect(readWorkspaceContextTheme(store, { shouldUseDarkColors: false })).resolves.toBe('light')
  })

  it('每次都从设置读当前值：切换 themeMode 后立刻生效，绝不缓存旧主题', async () => {
    const store = settingsStore('light')
    const system = { shouldUseDarkColors: false }
    await expect(readWorkspaceContextTheme(store, system)).resolves.toBe('light')
    store.setThemeMode('dark')
    await expect(readWorkspaceContextTheme(store, system)).resolves.toBe('dark')
  })

  /**
   * P1-06i（C）：OS 偏好必须**惰性**读取。
   * P1-06h 独立审查实测 `os getter reads = 4/4`：`system.shouldUseDarkColors` 作为实参被无条件求值，
   * 与「只在 system 分支才读 OS」的注释不符（行为本身正确，但注释/实现不一致，且给 non-system 路径
   * 凭空引入对 nativeTheme 的依赖）。本用例用计数 getter 固定「显式 dark/light 时读取 0 次」。
   */
  it('显式 dark/light 时一次都不读 OS 偏好；只有 system 分支才读（计数 getter）', async () => {
    let osReads = 0
    const system = { get shouldUseDarkColors(): boolean { osReads += 1; return true } }
    const store = settingsStore('light')

    await expect(readWorkspaceContextTheme(store, system)).resolves.toBe('light')
    store.setThemeMode('dark')
    await expect(readWorkspaceContextTheme(store, system)).resolves.toBe('dark')
    expect(osReads).toBe(0)

    store.setThemeMode('system')
    await expect(readWorkspaceContextTheme(store, system)).resolves.toBe('dark')
    expect(osReads).toBe(1)
  })
})

describe('readWorkspaceContextTimeZone：显示时区只由设置决定，system 才回退运行时', () => {
  it('设置 system 时用运行时 IANA 时区，显式时区原样透传', async () => {
    const store = settingsStore('system')
    await expect(readWorkspaceContextTimeZone(store, { timeZone: 'Asia/Shanghai' })).resolves.toBe('Asia/Shanghai')
    store.setTimeZone('America/New_York')
    await expect(readWorkspaceContextTimeZone(store, { timeZone: 'Asia/Shanghai' })).resolves.toBe('America/New_York')
  })

  it('运行时给不出时区时回落到 UTC，绝不猜地理时区', async () => {
    const store = settingsStore('system')
    await expect(readWorkspaceContextTimeZone(store, { timeZone: '' })).resolves.toBe('UTC')
  })
})

describe('app.ts 接线护栏（受保护 seam）：上下文主题必须走本模块，不得再直取 OS', () => {
  const appSource = readFileSync(resolve(__dirname, '../app.ts'), 'utf8')

  it('getTheme 委托给 readWorkspaceContextTheme(settingsStore, nativeTheme)', () => {
    expect(appSource).toContain('getTheme: () => readWorkspaceContextTheme(settingsStore, nativeTheme)')
    // 旧的直取 OS 写法不得回归（否则 app=dark 时上下文又会报 light）
    expect(appSource).not.toContain("getTheme: () => (nativeTheme.shouldUseDarkColors ? 'dark' : 'light')")
  })

  it('getTimeZone 委托给 readWorkspaceContextTimeZone(settingsStore, systemTimeZoneSource())', () => {
    // 显示时区必须与 shell 同源（settings.timeZone）；缺这条接线时分离窗与产品页会各自猜时区。
    expect(appSource).toContain('getTimeZone: () => readWorkspaceContextTimeZone(settingsStore, systemTimeZoneSource())')
    // 运行时 IANA 时区只允许在 systemTimeZoneSource 里读取，不得在偏好注入处直取
    expect(appSource).not.toContain("getTimeZone: async () => (await settingsStore.get()).timeZone")
  })
})
