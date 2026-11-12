import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { declaredTextKeysIn, literalAriaLabelKeys } from '@platform/ui/components/textKeyPaths'

import { resolveProductTextKey } from './productTextKey'

/**
 * 产品侧 `ariaLabelKey` 的键**必须真的能解析出一句话**——不是「像键」就算通过。
 *
 * 触发：`BriefingPushResultStrip` 三颗 IconButton 用哨兵键（`briefingPush.stripInfo` 等），
 * 键在 `productText` 里根本不存在，解析器自己把浮层正文顶上来当读屏名。形状守卫看不出这种假象，
 * 所以这里用**运行时同一个解析器**在两套语言里各取一次。
 *
 * 判据：
 * 1. `ariaLabelKey="字面量"`：`resolveProductTextKey(zh-CN, key)` 与 `(en-US, key)` 都必须非空；
 *    只在一套里有 → 红（缺翻译的那套会把空串念出去）。
 * 2. `ariaLabelKey={表达式}`：只能来自**同文件**的 `as const` 常量；其余形态红并报文件:行——
 *    猜不出它是什么，就当它没有键。
 *
 * 产品侧有几张表（主表 `productText`、通知屏那张自带完整路径的表、以及各屏自己的本地表），
 * 所以「存在」按两路判：主表能解析，或者**某张表里把它声明成了属性路径**（`declaredTextKeysIn`）。
 * 哨兵键两路都不满足——它只出现在比较式里。
 */
const ROOT = resolve(__dirname, '../../../../..')
const SCANNED_ROOTS = ['products']
const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'out', 'coverage', '.git', 'build', 'release'])

/** 主表在运行时会被这几层前缀补全（抽屉与门户都这么解析），守卫照同一套补。 */
const PREFIXES = ['', 'pages.intelligence.portal.dashboard.', 'pages.intelligence.portal.'] as const

export type AriaLabelOffender = Readonly<{ path: string; line: number; key: string; why: string }>

function resolves(key: string): boolean {
  for (const language of ['zh-CN', 'en-US'] as const) {
    const hit = PREFIXES.some((prefix) => resolveProductTextKey(language, `${prefix}${key}`) !== '')
    if (!hit) return false
  }
  return true
}

/** 同文件里的 `const NAME = '…' as const`：唯一的非字面量合法来源。 */
function sameFileConstKeys(text: string): Set<string> {
  const names = new Set<string>()
  for (const match of text.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*['"][^'"]*['"]\s*as\s+const/g)) {
    names.add(match[1] ?? '')
  }
  return names
}

/** 纯函数：给一组源码，返回违规点。注入式对偶用例直接喂它。 */
export function ariaLabelOffenders(
  sources: ReadonlyArray<Readonly<{ path: string; text: string }>>,
  /** 声明键的来源（默认同 `sources`）：文案表多在 `.ts` 里，调用点在 `.tsx` 里。 */
  declaredSources: ReadonlyArray<Readonly<{ path: string; text: string }>> = sources
): ReadonlyArray<AriaLabelOffender> {
  const declared = declaredTextKeysIn(declaredSources)
  const offenders: AriaLabelOffender[] = []
  for (const source of sources) {
    if (resolves('__never__')) continue // 只为让类型收窄，实际不用
    for (const entry of literalAriaLabelKeys(source.text)) {
      if (resolves(entry.key) || declared.has(entry.key)) continue
      offenders.push({ path: source.path, line: entry.line, key: entry.key, why: '键不在任何文案表里（两套语言都取不到）' })
    }
    for (const match of source.text.matchAll(/ariaLabelKey\s*=\s*\{([^}]+)\}/g)) {
      const expression = (match[1] ?? '').trim()
      if (/^['"][^'"]*['"]$/.test(expression)) continue // 字面量已经由上面那条判过
      /*
        非字面量的三类：
        - **标识符 / 成员表达式**（`props.ariaLabelKey`、`crossAssetTextKeys.refresh`、`INFO_LABEL_KEY`）：
          键来自某个常量或表，静态追不到它是不是真存在——这是本守卫的已知残差，不红；
        - **单字符串实参的调用**（`key('infoAria')`）：里面那句字面量就是键，按同一套解析判；
        - 其余（模板串、条件式等）：红——看不出它是什么，就当它没有键。
      */
      /*
        动态表达式（条件式、`??` 链、成员取值）本身不红——它常常就是合法的「从两条真键里挑一条」。
        但**里面出现的每一句字符串字面量都必须是真键**：这是同一条判据在最难写的形态上的落点。
        一个字符串都没有的（纯标识符/成员/调用）属已知残差，静态追不到，不红。
      */
      // 调用形态（`key('infoAria')`）里的字面量是**相对名**，不是全键：静态判不了，算残差。
      if (/^[A-Za-z_$][\w$]*\s*\(/.test(expression)) continue
      const literals = [...expression.matchAll(/['"]([^'"]+)['"]/g)]
        .map((literal) => literal[1] ?? '')
        .filter((literal) => literal !== '')
      const line = source.text.slice(0, match.index ?? 0).split('\n').length
      for (const literal of literals) {
        if (resolves(literal) || declared.has(literal)) continue
        offenders.push({ path: source.path, line, key: literal, why: '键不在任何文案表里（两套语言都取不到）' })
      }
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
    if (!/\.(ts|tsx)$/.test(entry.name)) continue
    if (/\.test\.(ts|tsx)$/.test(entry.name)) continue
    found.push(join(dir, entry.name))
  }
  return found
}

describe('ariaLabelKey 必须解析得出句子（产品侧）', () => {
  it('every literal key resolves in both zh-CN and en-US', () => {
    const allSources = SCANNED_ROOTS
      .flatMap((root) => sourceFiles(join(ROOT, root)))
      .map((file) => ({ path: relative(ROOT, file), text: readFileSync(file, 'utf8') }))
    // 调用点只在 `.tsx` 里；`.ts` 是文案表，只参与「这条键声明过吗」。
    const callSites = allSources.filter((source) => source.path.endsWith('.tsx'))

    expect(ariaLabelOffenders(callSites, allSources).map((entry) => `${entry.path}:${entry.line} ${entry.key} — ${entry.why}`)).toEqual([])
  })

  it('catches a missing key, a key only in one language, and a key that lives only in a comparison', () => {
    // 三组反向夹具：今天绿不能证明明天坏了会红。
    const missing = { path: 'a.tsx', text: '<IconButton ariaLabelKey="briefingPush.notInTable" />' }
    const real = { path: 'b.tsx', text: '<IconButton ariaLabelKey="configDrawer.title" />' }
    const sentinelOnly = {
      path: 'c.tsx',
      text: "<IconButton ariaLabelKey=\"briefingPush.stripInfo\" resolveText={(key) => key === 'briefingPush.stripInfo' ? 'X' : ''} />"
    }

    expect(ariaLabelOffenders([missing]).map((entry) => entry.key)).toEqual(['briefingPush.notInTable'])
    // 真实键（主表里能解析）不许红。
    expect(ariaLabelOffenders([real])).toEqual([])
    // 哨兵把键写在比较式里，仍然「没声明过」。
    expect(ariaLabelOffenders([sentinelOnly]).map((entry) => entry.key)).toEqual(['briefingPush.stripInfo'])
  })

  it('rejects a non-literal key that is not a same-file as-const constant', () => {
    const computed = { path: 'd.tsx', text: "<IconButton ariaLabelKey={revealed ? 'briefingPush.a' : 'briefingPush.b'} />" }
    const localConst = { path: 'e.tsx', text: "const CLOSE_KEY = 'configDrawer.title' as const\n<IconButton ariaLabelKey={CLOSE_KEY} />" }
    const callWithKey = { path: 'f.tsx', text: "<IconButton ariaLabelKey={key('infoAria')} />" }

    // 动态表达式里的字面量也要是真键：条件式两条分支都得能解析。
    expect(ariaLabelOffenders([computed]).map((entry) => entry.key)).toEqual(['briefingPush.a', 'briefingPush.b'])
    // 常量与成员表达式是已知残差（静态追不到），不红。
    expect(ariaLabelOffenders([localConst])).toEqual([])
    // 调用形态是已知残差（`key('infoAria')` 里的名字是相对名），不红也不假装验过。
    expect(ariaLabelOffenders([callWithKey])).toEqual([])
  })
})
