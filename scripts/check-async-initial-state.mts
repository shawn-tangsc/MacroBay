#!/usr/bin/env tsx
/**
 * 异步初值门禁（`MI-11-R161`）：**`useState` 的初值不许是终态。**
 *
 * 病：页面挂载时初值是 `'unavailable'` / `{ status: 'error' }`，于是先画一帧「读取失败」，
 * 数据到了再翻成正常。用户看到的是「加载中先闪失败」。这种写法**类型正确**，所以测试与
 * reviewer 都看不出来——只有这条机械扫描能拦。
 *
 * 判据只有两种形状（其余 `useState` 一律不管：布尔、字符串、null 都是正常用法）：
 * 1. `useState('error' | 'unavailable' | 'empty' | 'disabled' | 'permission')` —— 初值直接是终态字面量；
 * 2. `useState({ state: '<终态>' })` / `useState({ status: 'error' })` —— 初值是一个终态对象字面量。
 *
 * 白名单**只减不增**：修掉一处必须同笔删掉对应行；另有一条守卫钉住「条数不许变多」，
 * 否则这份名单三天后就是新的藏身处。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const ROOT = resolve(process.cwd())
const SCAN_ROOTS = ['apps/desktop-shell/src', 'platform', 'products']
const SKIP_DIRS = new Set(['node_modules', 'dist', 'out', 'coverage', '.git', 'build', 'release', 'generated'])

/** 终态词：读的「已经结束」的那些状态。`loading` / `ready` 不在里面。 */
const TERMINAL = ['error', 'unavailable', 'empty', 'disabled', 'permission']

/**
 * 遗留白名单：`文件 → 允许条数`。只减不增。
 *
 * 现在为空——类型与守卫先落地，各产品线按 `MI-11-R161` 逐模块迁。谁要加一条，
 * 先在台账登记理由，再加，并且删掉时同笔删行。
 */
export const LEGACY_ALLOWLIST: Readonly<Record<string, number>> = {}

const TERMINAL_LITERAL = new RegExp(
  String.raw`useState(?:<[^>]*>)?\(\s*['"](${TERMINAL.join('|')})['"]\s*\)`,
  'g'
)
const TERMINAL_OBJECT = new RegExp(
  String.raw`useState(?:<[^>]*>)?\(\s*\{\s*(?:state|status)\s*:\s*['"](${TERMINAL.join('|')}|error)['"]`,
  'g'
)
/** 已经是 `AsyncState` 的类型：初值必须是工厂调用，不许手写 `{ status: 'loading' }` 字面量。 */
const ASYNC_LITERAL = /useState<\s*AsyncState<[^>]*>\s*>\(\s*\{/g

export type Offender = { file: string; line: number; value: string }

function codeOnly(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

export function offendersIn(file: string, text: string): Offender[] {
  const code = codeOnly(text)
  const found: Offender[] = []
  for (const pattern of [TERMINAL_LITERAL, TERMINAL_OBJECT, ASYNC_LITERAL]) {
    for (const match of code.matchAll(pattern)) {
      const offset = match.index ?? 0
      found.push({
        file,
        line: code.slice(0, offset).split('\n').length,
        value: match[0].replace(/\s+/g, ' ')
      })
    }
  }
  return found
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue
    const full = join(dir, name)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      sourceFiles(full, out)
      continue
    }
    if (!/\.(ts|tsx)$/.test(name)) continue
    if (/\.(test|spec)\.tsx?$/.test(name)) continue
    out.push(full)
  }
  return out
}

function main(): void {
  const files = SCAN_ROOTS.flatMap((root) => sourceFiles(join(ROOT, root)))
  const offenders = files.flatMap((file) => offendersIn(relative(ROOT, file), readFileSync(file, 'utf8')))

  const allowed = new Map(Object.entries(LEGACY_ALLOWLIST))
  const unreported: Offender[] = []
  for (const offender of offenders) {
    const budget = allowed.get(offender.file) ?? 0
    if (budget > 0) {
      allowed.set(offender.file, budget - 1)
      continue
    }
    unreported.push(offender)
  }

  const stale = [...allowed.entries()].filter(([, remaining]) => remaining > 0)

  if (unreported.length === 0 && stale.length === 0) {
    console.log(`async-initial-state: ${files.length} files scanned, no settled initial value.`)
    return
  }

  if (unreported.length > 0) {
    console.error('async-initial-state: 初值是终态，页面会先闪一帧失败再翻成数据：')
    for (const offender of unreported) {
      console.error(`  ${offender.file}:${offender.line}  ${offender.value}`)
    }
    console.error('  初值只写 `initialAsyncState<T>()`：`data` 只挂在 ready 上，初态是 loading。')
  }
  if (stale.length > 0) {
    console.error('async-initial-state: 白名单里有已修好却还留着的条目（只减不增）：')
    for (const [file, remaining] of stale) console.error(`  ${file} × ${remaining}`)
  }
  process.exit(1)
}

if (process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '')) {
  main()
}
