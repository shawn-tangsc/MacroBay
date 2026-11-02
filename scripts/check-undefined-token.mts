#!/usr/bin/env tsx
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

/**
 * 未定义 CSS 变量门禁：`.css` 里写了 `var(--x)`，但全仓 `.css` 里没有任何 `--x:` 定义。
 *
 * 为什么这条必须存在：这不是「样式不统一」，是**属性整条失效**。`width: var(--avatar-size)`
 * 没有定义也没有兜底时，`width` 直接不生效，头像塌成 0；`border: 1px solid var(--mi-border)`
 * 没有兜底时边框整条消失，表格没有分隔线。带硬编码兜底的写法不报错，但在另一个主题下取的是
 * 写死的旧色——看起来能用、浅色下不对。两种都算这笔账，报告里分开列，因为修法不同。
 *
 * 三条口径，都是踩过之后定死的：
 *
 * 1. **只认脚本，不认回忆。** 这个数被报错过三次（125 / 45 / 19），原因只有一条：有人把
 *    「带兜底的写法」和「裸引用」混着数。所以这里不接任何手填的数字，只扫文件。
 * 2. **注释不算引用，也不算定义。** `tokens.css` 的文档注释里写着 `var(--token, #hex)` 作为
 *    反例讲解；把它算成一处坏掉的颜色，这条门禁第一天就带着一条永远修不掉的账。注释整段抹成
 *    空格（保留换行，行号不漂）。
 * 3. **定义只认静态 CSS。** TS 运行时用内联 style 注入的变量（见白名单）在 `.css` 里没有
 *    `--x:`，这是**正确写法**——值来自代码策略、读者设置或每次实例的数据，本来就不该有静态值。
 *    它们进白名单，每条写清「谁注入、哪个文件、为什么不能静态定义」。
 *
 * 白名单**双向**校验，防它长成藏身处：
 * - 注入文件里必须真的还能找到这个变量名，否则是笔误借着「运行时注入」的名义放行；
 * - 名字必须仍然有未定义引用，否则条目过期，必须删掉（只减不增）；
 * - 一旦有人在静态 CSS 里补了定义，条目同样过期。
 */

export const SCAN_ROOTS = ['apps', 'platform', 'products'] as const
export const WHITELIST_PATH = 'scripts/undefined-token-whitelist.json'

const SKIPPED_DIRECTORIES = new Set(['node_modules'])

export type TokenUse = { file: string; line: number; name: string; fallback: boolean }

/** 白名单条目：注入点必须能被机器复核，所以是路径 + 变量名，不是一句「运行时注入」。 */
export type WhitelistEntry = { injectedBy: string; file: string; reason: string }
export type Whitelist = Record<string, WhitelistEntry>

export type GateReport = { ok: boolean; output: string; undefined: TokenUse[] }

export type GateInput = {
  files: ReadonlyArray<{ file: string; css: string }>
  /** 读白名单里声明的注入文件；不存在返回 `null`。 */
  readText: (file: string) => string | null
  whitelist: Whitelist
}

const COMMENT_PATTERN = /\/\*[\s\S]*?\*\//g

export function stripComments(css: string): string {
  // 换成空格而不是删掉：删掉会把两行拼成一行，报出来的行号就指错地方了。
  return css.replace(COMMENT_PATTERN, (comment) => comment.replace(/[^\n]/g, ' '))
}

function lineStarts(text: string): number[] {
  const starts = [0]
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') starts.push(index + 1)
  }
  return starts
}

function lineOf(starts: readonly number[], offset: number): number {
  let low = 0
  let high = starts.length - 1
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if ((starts[middle] ?? 0) <= offset) low = middle
    else high = middle - 1
  }
  return low + 1
}

/** `--x:` 的定义。要求名字后面紧跟冒号，`--x-something` 不会被当成 `--x` 的定义。 */
export function scanDefinitions(css: string): string[] {
  const text = stripComments(css)
  const names: string[] = []
  const pattern = /--([A-Za-z0-9_-]+)\s*:/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    // `var(--x, fallback)` 里不可能出现 `--x:`，所以这里不需要再排掉引用位置。
    names.push(match[1] as string)
  }
  return names
}

/** 一处 `var(--x)` / `var(--x, fallback)`。`fallback` 决定修法，所以必须留下。 */
export function scanUses(css: string, file: string): TokenUse[] {
  const text = stripComments(css)
  const starts = lineStarts(text)
  const uses: TokenUse[] = []
  const pattern = /var\(\s*--([A-Za-z0-9_-]+)\s*(,)?/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    uses.push({
      file,
      line: lineOf(starts, match.index),
      name: match[1] as string,
      fallback: match[2] === ','
    })
  }
  return uses
}

function formatUse(use: TokenUse): string {
  return `${use.file}:${use.line}  --${use.name}`
}

export function evaluate(input: GateInput): GateReport {
  const defined = new Set<string>()
  for (const file of input.files) {
    for (const name of scanDefinitions(file.css)) defined.add(name)
  }

  const uses = input.files.flatMap((file) => scanUses(file.css, file.file))
  const undefinedUses = uses.filter((use) => !defined.has(use.name))
  const undefinedNames = new Set(undefinedUses.map((use) => use.name))

  // 白名单的键写成 `--x`（和 CSS 里读到的写法一致，评审时能直接对照），内部一律用不带前缀的名字。
  const whitelistEntries = Object.entries(input.whitelist).map(
    ([key, entry]) => [key.replace(/^--/u, ''), entry] as const
  )

  const whitelistProblems: string[] = []
  for (const [name, entry] of whitelistEntries.sort(([left], [right]) => left.localeCompare(right))) {
    if (!entry.injectedBy?.trim() || !entry.file?.trim() || !entry.reason?.trim()) {
      whitelistProblems.push(`--${name}：缺 injectedBy / file / reason。写不出一条理由，就说明它其实该改。`)
      continue
    }
    const injectedSource = input.readText(entry.file)
    if (injectedSource === null) {
      whitelistProblems.push(`--${name}：注入文件 ${entry.file} 不存在，注入点不成立。`)
      continue
    }
    if (!injectedSource.includes(`--${name}`)) {
      whitelistProblems.push(`--${name}：${entry.file} 里找不到 --${name}，注入点不成立（笔误不许借白名单放行）。`)
      continue
    }
    if (defined.has(name)) {
      whitelistProblems.push(`--${name}：静态 CSS 里已经有 --${name}: 定义，白名单条目过期，删掉它。`)
      continue
    }
    if (!undefinedNames.has(name)) {
      whitelistProblems.push(`--${name}：已经没有未定义引用了，白名单条目过期，删掉它。`)
    }
  }

  const listed = new Set(whitelistEntries.map(([name]) => name))
  const unlisted = undefinedUses.filter((use) => !listed.has(use.name))
  const bare = unlisted.filter((use) => !use.fallback)
  const withFallback = unlisted.filter((use) => use.fallback)
  const listedUses = undefinedUses.filter((use) => listed.has(use.name))
  const ok = bare.length === 0 && withFallback.length === 0 && whitelistProblems.length === 0

  const lines: string[] = []
  if (ok) {
    lines.push(
      `未定义 CSS 变量门禁通过：${input.files.length} 个 CSS 文件、${uses.length} 处 var() 引用；` +
        `未定义 0 处；白名单 ${Object.keys(input.whitelist).length} 个名字（${listedUses.length} 处引用）都是 TS 运行时注入，注入点都在。`
    )
    return { ok, output: lines.join('\n'), undefined: unlisted }
  }

  lines.push('未定义 CSS 变量门禁未通过。口径：`.css` 里 var(--x) 全仓没有 `--x:` 定义（注释不计）。')
  if (bare.length > 0) {
    const names = new Set(bare.map((use) => use.name)).size
    lines.push('', `无兜底 ${bare.length} 处 / ${names} 个名字 —— 属性整条失效，是坏的：`)
    for (const use of bare) lines.push(`  ${formatUse(use)}`)
  }
  if (withFallback.length > 0) {
    const names = new Set(withFallback.map((use) => use.name)).size
    lines.push('', `带硬编码兜底 ${withFallback.length} 处 / ${names} 个名字 —— 能显示，但用的是写死的色：`)
    for (const use of withFallback) lines.push(`  ${formatUse(use)}`)
  }
  if (whitelistProblems.length > 0) {
    lines.push('', '白名单问题（只放真有注入点的，且只减不增）：')
    for (const problem of whitelistProblems) lines.push(`  ${problem}`)
  }
  lines.push(
    '',
    `合计未定义 ${unlisted.length} 处 / ${new Set(unlisted.map((use) => use.name)).size} 个名字。` +
      '修法只有两条：换成已定义的 token，或在 tokens.css 里补一个两个主题都有的定义；' +
      '真·运行时注入的，进 scripts/undefined-token-whitelist.json 并写清注入点。'
  )
  return { ok, output: lines.join('\n'), undefined: unlisted }
}

export function collectCssFiles(root: string, roots: readonly string[]): string[] {
  const files: string[] = []
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (SKIPPED_DIRECTORIES.has(entry.name) || entry.name.startsWith('.')) continue
      const full = join(directory, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.css')) files.push(relative(root, full))
    }
  }
  for (const name of roots) {
    const directory = resolve(root, name)
    if (!existsSync(directory)) continue
    walk(directory)
  }
  return files.sort()
}

export function runGate(
  root: string,
  options: { roots?: readonly string[]; whitelistPath?: string } = {}
): GateReport {
  const whitelistFile = options.whitelistPath ?? resolve(root, WHITELIST_PATH)
  const whitelist = JSON.parse(readFileSync(whitelistFile, 'utf8')) as Whitelist
  const files = collectCssFiles(root, options.roots ?? SCAN_ROOTS)
  return evaluate({
    files: files.map((file) => ({ file, css: readFileSync(resolve(root, file), 'utf8') })),
    readText: (file) => {
      const full = resolve(root, file)
      return existsSync(full) ? readFileSync(full, 'utf8') : null
    },
    whitelist
  })
}

function main(): void {
  const report = runGate(resolve(process.cwd()))
  if (report.ok) {
    console.log(report.output)
    return
  }
  console.error(report.output)
  process.exit(1)
}

if (process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '')) {
  main()
}
