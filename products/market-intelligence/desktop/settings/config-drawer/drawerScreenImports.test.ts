// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * 抽屉的屏**各自一份实现**：抽屉目录里的文件不许 import 设置页那几块面板。
 *
 * 为什么：屏搬进抽屉时最省事的做法就是 `import { SourcesSettingsPane }`——那会让「抽屉」与
 * 「设置页」焊在一起，改一处两边一起变，用户要的「界面各一份」当场没了。
 *
 * 只认**真的 import**（`import` / `export … from` / `require(…)` / 动态 `import(…)`），
 * 注释里提到不算；**说明符解析成仓库相对路径再比目录**，不按子串比——`../` 换个写法就绕过去了。
 *
 * 例外按**文件**开（不是目录）：只读、只有一份实现的屏（运行日志的表格）与已认可保持现状的
 * 来源屏宿主。理由写在这一行里。
 */
const ROOT = process.cwd()
const DRAWER_DIR = 'products/market-intelligence/desktop/settings/config-drawer'

/** 不许被抽屉屏 import 的设置页面板所在目录 / 文件前缀（仓库相对路径）。 */
const FORBIDDEN = [
  'products/market-intelligence/desktop/settings/intelligence-sources/',
  'products/market-intelligence/desktop/settings/intelligence-notification/',
  'products/market-intelligence/desktop/pages/intelligence/DailyBriefingSettings',
  'products/market-intelligence/desktop/pages/intelligence/MarketAnalysisSettingsDialog'
] as const

/**
 * 文件级例外：路径 → 一行理由。**不是目录级白名单**，加一条就要写清为什么它是「一份实现」。
 */
const ALLOWED: Readonly<Record<string, string>> = {
  'products/market-intelligence/desktop/pages/intelligence/DashboardSourcesPanel.tsx':
    '来源与采集沿用设置页那两栏（用户已认可保持现状）：只这一份实现。',
  'products/market-intelligence/desktop/pages/intelligence/RunLogDrawerPanel.tsx':
    '运行日志是只读表格，设置页那份就是唯一实现；嵌进来用 variant="embed"。'
}

const SPECIFIER = /(?:^|\s)(?:import|export)\s[^'\n]*?from\s+'([^']+)'|(?:^|\s)import\s*\(\s*'([^']+)'\s*\)|require\(\s*'([^']+)'\s*\)/gu

/** 纯函数：源码 + 文件路径 + 允许集 → 违规行（`文件:行 imports '说明符'`）。 */
export function drawerScreenOffenders(
  file: Readonly<{ path: string; source: string }>,
  allowed: Readonly<Record<string, string>> = ALLOWED
): string[] {
  if (allowed[file.path] !== undefined) return []
  const hits: string[] = []
  const lines = file.source.split('\n')
  lines.forEach((line, index) => {
    const trimmed = line.trim()
    // 注释里提到不算：整行以 `//` 或 `*` 开头的一律跳过。
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return
    for (const match of line.matchAll(SPECIFIER)) {
      const specifier = match[1] ?? match[2] ?? match[3]
      if (specifier === undefined) continue
      const resolved = resolve(ROOT, file.path, '..', specifier)
      const relativePath = relative(ROOT, resolved).split('\\').join('/')
      if (FORBIDDEN.some((prefix) => relativePath.startsWith(prefix))) {
        hits.push(`${file.path}:${index + 1} imports '${specifier}'`)
      }
    }
  })
  return hits
}

function drawerFiles(): ReadonlyArray<{ path: string; source: string }> {
  const absolute = join(ROOT, DRAWER_DIR)
  return readdirSync(absolute)
    .filter((name) => name.endsWith('.tsx') && !name.includes('.test.'))
    .map((name) => {
      const path = `${DRAWER_DIR}/${name}`
      return { path, source: readFileSync(join(ROOT, path), 'utf8') }
    })
}

describe('the drawer screens own their implementation', () => {
  it('imports nothing from the settings-page panels', () => {
    const offenders = drawerFiles().flatMap((file) => drawerScreenOffenders(file))
    expect(offenders).toEqual([])
  })

  it('catches a real import: the guard is watching', () => {
    // 反证：真 import 必须报出来（这不是「0 offenders」能证明的）。
    const fake = [{
      path: `${DRAWER_DIR}/FakeScreen.tsx`,
      source: "import { SourcesSettingsPane } from '../intelligence-sources/SourcesSettingsPane'\n"
    }]
    expect(fake.flatMap((file) => drawerScreenOffenders(file))).toEqual([
      `${DRAWER_DIR}/FakeScreen.tsx:1 imports '../intelligence-sources/SourcesSettingsPane'`
    ])
  })

  it('does not resolve `../` tricks into a pass', () => {
    // 同一个目录，换一种写法：解析成绝对路径再比，照样命中。
    const sneaky = [{
      path: `${DRAWER_DIR}/FakeScreen.tsx`,
      source: "import { x } from '../intelligence-sources/./SettingsSourceTree'\n"
    }]
    expect(sneaky.flatMap((file) => drawerScreenOffenders(file))).toHaveLength(1)
  })

  it('opens the exception by file, not by directory', () => {
    // 例外文件自己放行；**同目录里另一个文件**写同样的 import 必须红——证明开的是文件不是目录。
    const source = "import { SourcesSettingsPane } from '../../settings/intelligence-sources/SourcesSettingsPane'\n"
    expect(drawerScreenOffenders({ path: 'products/market-intelligence/desktop/pages/intelligence/DashboardSourcesPanel.tsx', source })).toEqual([])
    expect(drawerScreenOffenders({ path: 'products/market-intelligence/desktop/pages/intelligence/RunLogDrawerPanel.tsx', source })).toEqual([])
    expect(drawerScreenOffenders({ path: 'products/market-intelligence/desktop/pages/intelligence/AnotherPanel.tsx', source }))
      .toHaveLength(1)
  })

  it('does not count a specifier that only appears in comments', () => {
    const commented = [{
      path: `${DRAWER_DIR}/FakeScreen.tsx`,
      source: "// 不要 import '../intelligence-sources/SourcesSettingsPane'\n/* 也不行 */\n"
    }]
    expect(commented.flatMap((file) => drawerScreenOffenders(file))).toEqual([])
  })
})
