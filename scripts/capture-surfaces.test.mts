import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, posix, relative, sep } from 'node:path'

import { describe, expect, it } from 'vitest'

import { captureOnlySurfaces, captureSurfacePathProblem, isCaptureOnlySurface } from './check-body-prose.mts'

/**
 * 截图面豁免（`check-body-prose.mts` 的 `CAPTURE_ONLY_SURFACES`）的四面墙。
 *
 * 豁免本身说的是「这句话在**正文位置**不算说明句」——因为产物是一张图，图上没有 ⓘ。它**不**等于
 * 「这个文件不用守规矩」：内部进度话术、手写第二份文案、图上的数不走契约结算，在导出面上一样禁。
 * 所以这里不测「名单里有它」，测的是**结构事实**：它只被导出入口引用、名单条目只能精确指一个文件、
 * 导出面里一个字都不许手写、那句话只有一处生产。
 */
const ROOT = process.cwd()
const SOURCE_ROOTS = ['apps', 'platform', 'products']
const SKIP_DIRS = new Set(['node_modules', 'out', 'dist', '.git', 'coverage'])
const POSTER_WINDOW = 'products/market-intelligence/desktop/pages/intelligence/BriefingPosterWindow.tsx'
const POSTER_ENTRY = 'products/market-intelligence/desktop/pages/briefing-poster/index.tsx'
const SHARE_HOST = 'products/market-intelligence/desktop/pages/intelligence/DailyBriefingShareHost.tsx'

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.(?:[cm]?[jt]sx?)$/u.test(entry.name)) out.push(full)
  }
  return out
}

/** 仓库里的源码文件（相对仓库根、`/` 分隔），`*.test.*` 也在内——由调用方自己决定要不要。 */
function sourceFiles(): readonly string[] {
  return SOURCE_ROOTS.flatMap((root) => walk(join(ROOT, root))).map((file) => relative(ROOT, file).split(sep).join('/'))
}

const SPECIFIER = /(?:from\s*|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/gu

/** 纯函数：一段源码里相对导入落在哪个文件（解析不到就 `null`）。 */
export function resolveRelativeImport(fromFile: string, specifier: string, files: ReadonlySet<string>): string | null {
  if (!specifier.startsWith('.')) return null
  const base = posix.normalize(posix.join(posix.dirname(fromFile), specifier))
  for (const candidate of [base, `${base}.tsx`, `${base}.ts`, `${base}/index.tsx`, `${base}/index.ts`]) {
    if (files.has(candidate)) return candidate
  }
  return null
}

/** 纯函数：谁 import 了 `target`（只看一层、按路径排序）。 */
export function importersOf(target: string, files: readonly string[]): readonly string[] {
  const known = new Set(files)
  return files
    .filter((file) => file !== target)
    .filter((file) => {
      const text = readFileSync(join(ROOT, file), 'utf8')
      for (const match of text.matchAll(SPECIFIER)) {
        if (resolveRelativeImport(file, match[1]!, known) === target) return true
      }
      return false
    })
    .sort()
}

/**
 * 纯函数：去掉注释，只留代码与字符串。
 *
 * 导出面里全是中文注释（「这里不拼句子」这类），不剥掉注释就等于把说明文字当成手写文案在报。
 * 用最小扫描器而不是正则：`'//'`、`'/*'` 出现在字符串里时，按行切的正则会把后面整段代码当成注释。
 */
export function stripComments(text: string): string {
  let out = ''
  let index = 0
  while (index < text.length) {
    const two = text.slice(index, index + 2)
    if (two === '//') {
      const end = text.indexOf('\n', index)
      index = end === -1 ? text.length : end
      continue
    }
    if (two === '/*') {
      const end = text.indexOf('*/', index + 2)
      index = end === -1 ? text.length : end + 2
      continue
    }
    const quote = text[index]!
    if (quote === '\'' || quote === '"' || quote === '`') {
      let cursor = index + 1
      while (cursor < text.length) {
        if (text[cursor] === '\\') { cursor += 2; continue }
        if (text[cursor] === quote) { cursor += 1; break }
        cursor += 1
      }
      out += text.slice(index, cursor)
      index = cursor
      continue
    }
    out += quote
    index += 1
  }
  return out
}

/** 纯函数：代码里（不含注释）出现的中文字面量。 */
export function chineseLiterals(text: string): readonly string[] {
  return [...stripComments(text).matchAll(/['"`]([^'"`\n]*[\u4e00-\u9fff][^'"`\n]*)['"`]/gu)].map((match) => match[1]!)
}

/**
 * 条件①：豁免要能**被结构证明**，不能只写在注释里。
 *
 * 海报窗口只该被那个导出入口引用：再被任何可见页面 import 一次，它就是界面的一部分，
 * 「产物是一张图」这句话不成立了。`*.test.*` 不算（测试不渲染），但 `index.tsx` 才算入口。
 */
describe('the capture-only exemption is structural, not a comment', () => {
  it('the poster window is imported by exactly the export entry', () => {
    const runtimeFiles = sourceFiles().filter((file) => !file.includes('.test.'))
    expect(importersOf(POSTER_WINDOW, runtimeFiles)).toEqual([POSTER_ENTRY])
  })

  it('the share host is imported by exactly the briefing page that paints the image', () => {
    const runtimeFiles = sourceFiles().filter((file) => !file.includes('.test.'))
    expect(importersOf(SHARE_HOST, runtimeFiles)).toEqual([
      'products/market-intelligence/desktop/pages/intelligence/DailyBriefingPage.tsx'
    ])
  })
})

/**
 * 条件④：名单条目只能精确指一个 `.tsx` 文件。
 *
 * 通配会顺手放过一批文件、目录会连以后新建的也算进来、正则没法审——三条都会让「这处是不是导出面」
 * 变成没人复核的默认值。坏样本在下面逐条构造，红了才算这条用例有用。
 */
describe('capture-only entries can only name one exact file', () => {
  it('refuses a glob, a directory, a regex and a bare path', () => {
    expect(captureSurfacePathProblem('products/**/*.tsx')).not.toBeNull()
    expect(captureSurfacePathProblem('products/market-intelligence/desktop/pages/intelligence/')).not.toBeNull()
    expect(captureSurfacePathProblem('products/.*\\.tsx')).not.toBeNull()
    expect(captureSurfacePathProblem('./products/market-intelligence/desktop/pages/intelligence/BriefingPosterWindow.tsx')).not.toBeNull()
    expect(captureSurfacePathProblem('/products/market-intelligence/desktop/pages/intelligence/BriefingPosterWindow.tsx')).not.toBeNull()
  })

  it('refuses a path that is not a single existing .tsx file', () => {
    expect(captureSurfacePathProblem('products/market-intelligence/desktop/pages/intelligence/Missing.tsx')).toBe('文件不存在')
    expect(captureSurfacePathProblem('products/market-intelligence')).toBe('必须是 .tsx 文件')
    expect(captureSurfacePathProblem('scripts/body-prose-baseline.json')).toBe('必须是 .tsx 文件')
  })

  it('accepts the real list, with one file behind each entry and no duplicates', () => {
    const list = captureOnlySurfaces()
    expect(list.length).toBeGreaterThan(0)
    expect(new Set(list).size).toBe(list.length)
    for (const entry of list) {
      expect(captureSurfacePathProblem(entry)).toBeNull()
      expect(statSync(join(ROOT, entry)).isFile()).toBe(true)
      expect(isCaptureOnlySurface(entry)).toBe(true)
    }
  })
})

/**
 * 条件③：豁免只免「说明句在正文位置」这一条。
 *
 * 导出面上**一个字都不许手写**——文案来自文案表、那句完整性说明来自 `posterProps`、数字来自契约结算。
 * 于是内部进度话术（「本版只验证…」「本版不采集…」）在图上无处可藏：它只能以中文字面量出现，而这里
 * 一个字面量都不放过。手写第二份文案同样是红。
 */
describe('export surfaces carry no hand-written copy', () => {
  it('finds Chinese literals when they are code, and ignores the comments', () => {
    expect(chineseLiterals("const a = '本期缺 2 项数据。'")).toEqual(['本期缺 2 项数据。'])
    expect(chineseLiterals('// 本版只验证一件事\nconst a = 1')).toEqual([])
    expect(chineseLiterals('/* 本版不采集 */ const a = 1')).toEqual([])
  })

  it('every capture surface writes no copy of its own', () => {
    const offenders = captureOnlySurfaces().flatMap((file) =>
      chineseLiterals(readFileSync(join(ROOT, file), 'utf8')).map((literal) => `${file} :: ${literal}`))
    expect(offenders).toEqual([])
  })
})

/**
 * 条件⑤：那句话保留成句子，但**只有一处生产**，海报与页面拿到的是同一个字符串。
 *
 * 两半都断：生产者唯一（`dailyBriefingPoster.ts`），且导出面自己不再按 `completeness` 的键去取文案
 * （那会变成第二份，改了一边忘了另一边）。
 */
describe('one sentence, produced once', () => {
  const runtime = (): readonly string[] =>
    sourceFiles().filter((file) => !file.includes('.test.') && file.endsWith('.ts'))

  it('only the poster props module calls the completeness builder', () => {
    const callers = runtime().filter((file) => readFileSync(join(ROOT, file), 'utf8').includes('buildEditionCompletenessNote'))
    expect(callers).toEqual([
      'products/market-intelligence/desktop/pages/intelligence/dailyBriefingCompletenessNote.ts',
      'products/market-intelligence/desktop/pages/intelligence/dailyBriefingPoster.ts'
    ])
  })

  it('the surfaces pass the sentence through instead of reading the copy keys themselves', () => {
    const offenders = captureOnlySurfaces().filter((file) => /\.completeness\b/u.test(readFileSync(join(ROOT, file), 'utf8')))
    expect(offenders).toEqual([])
  })
})