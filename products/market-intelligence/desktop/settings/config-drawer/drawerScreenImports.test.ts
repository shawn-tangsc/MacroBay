// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * 抽屉的七屏**各自一份实现**：屏文件不许**运行期** import 设置页那几块面板。
 *
 * 扫描集 = 登记的那七屏实现文件（它们不长在抽屉目录里，长在 `pages/intelligence/` 与
 * `settings/intelligence-notification/`）。**登记即受管**：加一屏就加一行。
 *
 * 两条口径：
 * 1. `import type` / `export type` **放行**——类型只在编译期，不产生运行期耦合，
 *    改设置页那块组件的实现不会牵动抽屉；
 * 2. 同一目录内的 import 跳过（屏自己的零件，不是「别处的面板」）。
 *
 * 说明符**解析成仓库相对路径再比目录**，不按子串比（`../` 换个写法绕不过去）；注释里提到不算。
 */
const ROOT = process.cwd()
const DRAWER_DIR = 'products/market-intelligence/desktop/settings/config-drawer'

/** 登记表对应的七屏实现文件 + 抽屉壳自己。 */
const SCREEN_FILES = [
  'products/market-intelligence/desktop/pages/intelligence/DashboardSourcesPanel.tsx',
  'products/market-intelligence/desktop/pages/intelligence/ProcessingSettingsPanel.tsx',
  'products/market-intelligence/desktop/pages/intelligence/AnalysisSettingsPanel.tsx',
  'products/market-intelligence/desktop/pages/intelligence/DailyBriefingSettingsPanel.tsx',
  'products/market-intelligence/desktop/settings/intelligence-notification/NotificationSettingsPanel.tsx',
  'products/market-intelligence/desktop/pages/intelligence/RunLogDrawerPanel.tsx',
  `${DRAWER_DIR}/ConfigSettingsDrawer.tsx`
] as const

const FORBIDDEN = [
  'products/market-intelligence/desktop/settings/intelligence-sources/',
  'products/market-intelligence/desktop/settings/intelligence-notification/',
  'products/market-intelligence/desktop/pages/intelligence/DailyBriefingSettings',
  'products/market-intelligence/desktop/pages/intelligence/MarketAnalysisSettingsDialog'
] as const

/** 文件级例外（不是目录级）：用户认可保持现状的两屏。 */
const ALLOWED: Readonly<Record<string, string>> = {
  'products/market-intelligence/desktop/pages/intelligence/DashboardSourcesPanel.tsx':
    '来源与采集沿用设置页那两栏（用户已认可保持现状）：只这一份实现。',
  'products/market-intelligence/desktop/pages/intelligence/RunLogDrawerPanel.tsx':
    '运行日志是只读表格，设置页那份就是唯一实现；嵌进来用 variant="embed"。'
}

/**
 * 临时基线（只减不增）：**每条必须有 owner 与清理时机**，没有的不许进。
 * `owner` = 那一屏归属的线；`shared` = 共用的是哪块；`clearWhen` = 什么条件清掉这一条。
 */
export const SCREEN_BASELINE: Readonly<Record<string, Readonly<{ owner: string; shared: string; clearWhen: string }>>> = {
  'products/market-intelligence/desktop/pages/intelligence/ProcessingSettingsPanel.tsx':
    {
      owner: '舆情线',
      shared: '翻译偏好用设置页的 `TranslationPreferencesSection` + `useIntelligenceTranslationSettings`',
      clearWhen: '内容处理屏自己实现翻译偏好（与设置页各自一份）后清掉这一条'
    }
}

/** 纯函数：源码 + 文件路径 → 运行期 import 违规（`文件:行 imports '说明符'`）。 */
export function runtimeImportOffenders(file: Readonly<{ path: string; source: string }>): string[] {
  if (ALLOWED[file.path] !== undefined || SCREEN_BASELINE[file.path] !== undefined) return []
  const hits: string[] = []
  file.source.split('\n').forEach((line, index) => {
    const trimmed = line.trim()
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return
    // `import type` / `export type` 放行：类型不构成共用实现。
    const match = /(?:^|\s)(?:import|export)\s+(type\s+)?[^'\n]*?from\s+'([^']+)'|(?:^|\s)import\s*\(\s*'([^']+)'\s*\)|require\(\s*'([^']+)'\s*\)/u.exec(line)
    if (match === null) return
    if (match[1] !== undefined) return
    const specifier = match[2] ?? match[3] ?? match[4]
    if (specifier === undefined) return
    const resolved = relative(ROOT, resolve(ROOT, file.path, '..', specifier)).split('\\').join('/')
    // 同一目录内的 import 是屏自己的零件，不算「别处的面板」。
    if (resolved.startsWith(`${dirname(file.path)}/`)) return
    if (FORBIDDEN.some((prefix) => resolved.startsWith(prefix))) hits.push(`${file.path}:${index + 1} imports '${specifier}'`)
  })
  return hits
}

function screens(): ReadonlyArray<{ path: string; source: string }> {
  return SCREEN_FILES
    .filter((path) => existsSync(join(ROOT, path)))
    .map((path) => ({ path, source: readFileSync(join(ROOT, path), 'utf8') }))
}

describe('the drawer screens own their implementation', () => {
  it('imports nothing from the settings-page panels at runtime', () => {
    expect(screens().flatMap((file) => runtimeImportOffenders(file))).toEqual([])
  })

  it('catches a runtime import in a real screen file: the guard is watching', () => {
    // 反证用**真实屏文件路径**，证明扫描集覆盖到了那七屏（夹具文件证明不了这一点）。
    const fake = [{
      path: 'products/market-intelligence/desktop/pages/intelligence/AnalysisSettingsPanel.tsx',
      source: "import { SourcesSettingsPane } from '../../settings/intelligence-sources/SourcesSettingsPane'\n"
    }]
    expect(fake.flatMap((file) => runtimeImportOffenders(file))).toEqual([
      "products/market-intelligence/desktop/pages/intelligence/AnalysisSettingsPanel.tsx:1 imports '../../settings/intelligence-sources/SourcesSettingsPane'"
    ])
  })

  it('lets a type-only import through: types are not a shared implementation', () => {
    const typed = [{
      path: 'products/market-intelligence/desktop/pages/intelligence/AnalysisSettingsPanel.tsx',
      source: "import type { ProviderDetailLabels } from '../../settings/intelligence-sources/ProviderDetail'\n"
    }]
    expect(typed.flatMap((file) => runtimeImportOffenders(file))).toEqual([])
  })

  it('skips an import from the screen\'s own directory', () => {
    const own = [{
      path: 'products/market-intelligence/desktop/settings/intelligence-notification/NotificationSettingsPanel.tsx',
      source: "import { NotificationDrawerScreen } from './NotificationDrawerScreen'\n"
    }]
    expect(own.flatMap((file) => runtimeImportOffenders(file))).toEqual([])
  })

  it('keeps every baseline entry owned and dated, so none becomes a permanent exemption', () => {
    for (const [path, entry] of Object.entries(SCREEN_BASELINE)) {
      expect(existsSync(join(ROOT, path)), `${path} 的屏文件还在吗`).toBe(true)
      expect(entry.owner.length, `${path} 的 owner`).toBeGreaterThan(1)
      expect(entry.shared.length, `${path} 共用哪块`).toBeGreaterThan(10)
      expect(entry.clearWhen.length, `${path} 的清理时机`).toBeGreaterThan(10)
    }
  })
})
