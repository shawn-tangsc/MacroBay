import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { AppLanguage } from '@platform/settings/schema/appSettings'
import { declaredTextKeysIn, literalAriaLabelKeys } from '@platform/ui/components/textKeyPaths'

import type { ShellTextTable } from './textTableRegistry'
import { SHELL_TEXT_TABLES } from './textTableRegistry'

/**
 * 壳层（`apps/**`）的 `ariaLabelKey`：**键必须在真实完整路径上解析得出句子**。
 *
 * 这一半是补出来的：平台侧那条守卫只查「这个字符串是不是某个对象字面量的属性名」。
 * 平台设置在实修时把新键插进了 `settings.notifications` 下——属性名存在，守卫绿；
 * 可运行时按 `notifications.*` 解析，`Popover` 当场抛「no copy」。**声明过 ≠ 解析得到**。
 *
 * 所以这里用**与运行时同一张表**（`platformText`，壳层渲染就是读它）按完整路径取一次：
 * zh-CN 与 en-US 都必须非空。只在一套里有 → 红（缺翻译的那套会把空串念出去）。
 *
 * 产品侧那条守卫本来就是按真实路径解析的（`resolveProductTextKey`），所以它没有这个洞；
 * 两侧判据在这里补齐，不再一边严一边松。
 */
const ROOT = resolve(__dirname, '../../../../../..')
const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'out', 'coverage', '.git', 'build', 'release'])

export type UnresolvedKey = Readonly<{ path: string; line: number; key: string; missing: readonly AppLanguage[] }>

/** 语言 → 展平后的「点分路径 → 句子」。同一个 flatten，壳层运行时也这么查。 */
function flattenTable(node: unknown, prefix: string, into: Map<string, string>): void {
  if (typeof node === 'string') {
    into.set(prefix, node)
    return
  }
  if (Array.isArray(node)) {
    node.forEach((item, index) => flattenTable(item, `${prefix}.${index}`, into))
    return
  }
  if (node !== null && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      flattenTable(value, prefix === '' ? key : `${prefix}.${key}`, into)
    }
  }
}

/**
 * 把登记的每张表展平成「点分路径 → 句子」，按语言合成两张查询表。
 * 清单为空或某张表只有一种语言，这里就会缺半边——守卫的清单校验那条会先红。
 */
export function shellTables(
  registry: readonly ShellTextTable[] = SHELL_TEXT_TABLES
): Readonly<Record<AppLanguage, ReadonlyMap<string, string>>> {
  const tables = { 'zh-CN': new Map<string, string>(), 'en-US': new Map<string, string>() }
  for (const entry of registry) {
    for (const language of ['zh-CN', 'en-US'] as const) {
      const flattened = new Map<string, string>()
      flattenTable(entry.tables[language], '', flattened)
      for (const [key, value] of flattened) {
        if (value === '') continue
        // 表里的路径与调用点写的键可能差一层前缀（`modelService.`）：两条都登记，解析时不用再剥。
        const full = `${entry.keyPrefix ?? ''}${key}`
        if (!tables[language].has(full)) tables[language].set(full, value)
        if (!tables[language].has(key)) tables[language].set(key, value)
      }
    }
  }
  return tables
}

/**
 * 纯函数：给一组源码与两张表，返回「声明得到、但完整路径解析不出句子」的键。
 * 注入式用例直接喂假表，证明这次那个形状会被抓住。
 */
export function unresolvedKeys(
  sources: ReadonlyArray<Readonly<{ path: string; text: string }>>,
  tables: Readonly<Record<AppLanguage, ReadonlyMap<string, string>>>
): ReadonlyArray<UnresolvedKey> {
  const offenders: UnresolvedKey[] = []
  for (const source of sources) {
    // 同一文件里的本地映射（`rowActionText[key] ?? ''`）就是这一处的解析器：它声明在哪，运行时就读它。
    // 这条不等于给「属性名存在」开口子——事故那个形状是**在别的文件里**声明、调用点却按另一条路径读。
    const localKeys = declaredTextKeysIn([source])
    for (const entry of literalAriaLabelKeys(source.text)) {
      if (localKeys.has(entry.key)) continue
      const missing = (['zh-CN', 'en-US'] as const)
        .filter((language) => (tables[language].get(entry.key) ?? '') === '')
      if (missing.length > 0) offenders.push({ path: source.path, line: entry.line, key: entry.key, missing })
    }
  }
  return offenders
}

function sourceFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIPPED_DIRS.has(entry.name)) continue
      found.push(...sourceFiles(join(dir, entry.name)))
      continue
    }
    if (!/\.tsx$/.test(entry.name)) continue
    if (/\.test\.tsx$/.test(entry.name)) continue
    found.push(join(dir, entry.name))
  }
  return found
}

describe('壳层 ariaLabelKey 必须按完整路径解析得出句子', () => {
  it('every literal key resolves in both languages', () => {
    const sources = sourceFiles(join(ROOT, 'apps'))
      .map((file) => ({ path: relative(ROOT, file), text: readFileSync(file, 'utf8') }))

    expect(unresolvedKeys(sources, shellTables())
      .map((entry) => `${entry.path}:${entry.line} ${entry.key} 缺 ${entry.missing.join('/')}`)).toEqual([])
  })

  it('catches a key that is declared under a parent but not at the path runtime reads', () => {
    // 这就是平台设置撞出来的形状：新键插在 `settings.notifications.*` 下，属性名一直存在（旧判据绿），
    // 但运行时读的是 `notifications.*`（新判据红）。
    // 键声明在**另一张表里**（错的父节点），调用点按它的完整路径读 —— 运行时就会读不到。
    const wrongParentTable = { path: 'i18n/settingsTable.ts', text: "export const T = { settings: { notifications: { pushSection: '推送' } } }" }
    const callSite = { path: 'settings/Screen.tsx', text: '<Popover resolveText={noop} ariaLabelKey="settings.notifications.pushSection" />' }
    const tables = {
      'zh-CN': new Map([['notifications.pushSection', '推送提醒']]),
      'en-US': new Map([['notifications.pushSection', 'Push reminders']])
    }

    // 旧判据（只看属性名）：这条键确实在源码里声明过 → 绿。
    expect(declaredTextKeysIn([wrongParentTable]).has('settings.notifications.pushSection')).toBe(true)
    // 新判据（完整路径解析）：两套语言都取不到 → 红。
    expect(unresolvedKeys([callSite], tables).map((entry) => entry.key)).toEqual(['settings.notifications.pushSection'])

    // 反向：把键改回真实路径 → 绿。
    const fixed = { path: 'settings/Screen.tsx', text: '<Popover ariaLabelKey="notifications.pushSection" />' }
    expect(unresolvedKeys([fixed], tables)).toEqual([])

    // 同文件本地映射是合法形态（`rowActionText[key] ?? ''`），不红。
    const localMap = {
      path: 'channels/Row.tsx',
      text: "const rowActionText: Record<string, string> = { 'settings.channels.edit': '\u7f16\u8f91' }\nconst resolveText = (key: string) => rowActionText[key] ?? ''\nconst A = <IconButton ariaLabelKey=\"settings.channels.edit\" resolveText={resolveText} />"
    }

    expect(unresolvedKeys([localMap], tables)).toEqual([])
  })

  it('goes red when a registered table is dropped, so the list cannot become decorative', () => {
    // 反证「清单真的在起作用」：把 `agentText` 从登记表里删掉，只靠 `platformText` 解析的键必须红。
    const withoutAgentText = SHELL_TEXT_TABLES.filter((entry) => entry.id !== 'agentText')
    expect(withoutAgentText.length).toBe(SHELL_TEXT_TABLES.length - 1)

    const callSite = { path: 'agents/Nav.tsx', text: '<Tooltip labelKey="messages.navigateTop" ariaLabelKey="messages.navigateTop" />' }
    expect(shellTables(withoutAgentText)['zh-CN'].has('messages.navigateTop')).toBe(false)
    expect(unresolvedKeys([callSite], shellTables(withoutAgentText)).map((entry) => entry.key))
      .toEqual(['messages.navigateTop'])
    // 登记齐全时同一个键是绿的——红的来源只能是「清单少了表」，不是键本身有问题。
    expect(unresolvedKeys([callSite], shellTables())).toEqual([])
  })

  it('rejects a key that only one language has', () => {
    const source = { path: 'a.tsx', text: '<IconButton ariaLabelKey="ast.onlyEn" />' }
    const tables = {
      'zh-CN': new Map<string, string>(),
      'en-US': new Map([['ast.onlyEn', 'English only']])
    }

    expect(unresolvedKeys([source], tables).map((entry) => entry.missing)).toEqual([['zh-CN']])
  })
})
