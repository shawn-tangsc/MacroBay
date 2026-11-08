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
 *
 * ## 第二种形状：把「还没读到」画成「读不到」（2026-11-07 加的）
 *
 * 事故：设置页把 `value === undefined` 当读失败，而正常加载的第一帧就是 `undefined`，
 * 于是用户一进页面就看到「读取失败」。初值完全合法，上面那三种形状抓不到它——
 * 错在**渲染分支里的映射**，不在初始化器。
 *
 * 判据：一个 `.tsx` 里，**错误态的渲染条件对可选值做 `=== undefined`**，且**这个文件与它同目录的
 * `use*.ts(x)` 都没有 `'loading'` 档** → 红。有 loading 档时，`undefined` 走到 error 分支已是
 * 不可达的兜底；没有 loading 档，它就是「未加载当读不到」本身。
 *
 * ## 它抓不到什么（别当成全都抓到了）
 *
 * - 用 `0` / `[]` / `''` 当「还没加载」的写法；
 * - 「先渲染一遍、再被 effect 覆盖」的写法；
 * - 把加载态藏在父组件、由子组件读 props 的写法（本判据只看同一个文件与同目录 hook）。
 * 这三类仍归人审。
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

/**
 * 渲染分支白名单：文件 → { 理由, 位置特征 }。**只减不增**。
 *
 * 每条必须带 `signature`：命中点附近仍能读到的特征串。脚本会校验两件事——
 * ① 这个文件**仍然命中**（修好了就该删条目，否则它会永远逃审）；
 * ② 特征串**仍然在文件里**（重构后条目指向的东西已经不在，理由也就失效了）。
 */
export const RENDER_BRANCH_ALLOWLIST: Readonly<
  Record<string, Readonly<{ reason: string; signature: string }>>
> = {}

/**
 * 现在为空：干跑只命中过一个文件（`TaskAutomationTasksSection.tsx`），而它命中的是
 * `focusTaskId === null` 那条滚动守卫——判据收紧到「可选值 `=== undefined`」后不再命中，
 * 所以没有条目要留。机制（理由 + 位置特征 + 过期校验）留着，下次真需要时才有约束。
 */
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

/** StateView 的终态：`state="error"` / `state={'error'}` 都算。 */
const TERMINAL_RENDER = /state=\{?\s*['"](error|unavailable)['"]/
const UNDEFINED_AS_ERROR = /===\s*undefined/

/** 这个文件读异步状态吗？只扫这类文件，避免全仓乱扫。 */
function readsAsyncState(text: string): boolean {
  return /\buse(State|Effect|SyncExternalStore)\b|\bfrom ['"][^'"]*(ipc|Client)['"]/.test(text)
}

/** 文件自己或同目录的 `use*.ts(x)` 里有没有 loading 档。 */
function hasLoadingConcept(file: string, text: string, siblingText: string): boolean {
  const probe = `${text}\n${siblingText}`
  return /['"]loading['"]/.test(probe)
}

/**
 * 第二种形状的命中：错误态渲染条件对可选值做 `=== undefined`，且没有 loading 档。
 * 只看 `.tsx`（要渲染），且只看出现在 `if`/三元/短路里的判空。
 */
export function undefinedAsErrorIn(
  file: string,
  text: string,
  options: Readonly<{ siblingText?: string }> = {}
): Offender[] {
  if (!file.endsWith('.tsx')) return []
  const code = codeOnly(text)
  if (!readsAsyncState(code)) return []
  if (hasLoadingConcept(file, code, options.siblingText ?? '')) return []
  const lines = code.split('\n')
  const found: Offender[] = []
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    if (!UNDEFINED_AS_ERROR.test(line)) continue
    const window = lines.slice(i, i + 8).join('\n')
    if (!TERMINAL_RENDER.test(window)) continue
    found.push({ file, line: i + 1, value: line.trim() })
  }
  return found
}

function siblingHooks(file: string): string {
  const dir = file.slice(0, file.lastIndexOf('/'))
  try {
    return readdirSync(join(ROOT, dir))
      .filter((name) => /^use.*\.tsx?$/.test(name))
      .map((name) => readFileSync(join(ROOT, dir, name), 'utf8'))
      .join('\n')
  } catch {
    return ''
  }
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

  const renderOffenders = files
    .filter((file) => file.endsWith('.tsx'))
    .map((file) => {
      const rel = relative(ROOT, file)
      const text = readFileSync(file, 'utf8')
      return undefinedAsErrorIn(rel, text, { siblingText: siblingHooks(rel) })
    })
    .flat()

  const allowedRender = new Set(Object.keys(RENDER_BRANCH_ALLOWLIST))
  const renderUnreported = renderOffenders.filter((offender) => !allowedRender.has(offender.file))
  const expiredEntries = Object.entries(RENDER_BRANCH_ALLOWLIST).filter(([file, entry]) => {
    const stillHit = renderOffenders.some((offender) => offender.file === file)
    const signatureAlive = (() => {
      try {
        return readFileSync(join(ROOT, file), 'utf8').includes(entry.signature)
      } catch {
        return false
      }
    })()
    return !stillHit || !signatureAlive
  })

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

  if (renderUnreported.length > 0) {
    console.error('async-initial-state: 把「还没读到」画成了「读不到」（有 loading 档就不会命中）：')
    for (const offender of renderUnreported) console.error(`  ${offender.file}:${offender.line}  ${offender.value}`)
    console.error('  修法：给这个状态加 `loading` 档并前置返回，undefined 不再兼作两种含义。')
  }
  if (expiredEntries.length > 0) {
    console.error('async-initial-state: 渲染分支白名单里有已过期条目（修好了就删，重构了要更新理由）：')
    for (const [file, entry] of expiredEntries) console.error(`  ${file}  (signature: ${entry.signature})`)
  }

  if (unreported.length === 0 && stale.length === 0 && renderUnreported.length === 0 && expiredEntries.length === 0) {
    console.log(
      `async-initial-state: ${files.length} files scanned, no settled initial value, ` +
        `no "not loaded as unreadable" branch (${Object.keys(RENDER_BRANCH_ALLOWLIST).length} allowlisted).`
    )
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
