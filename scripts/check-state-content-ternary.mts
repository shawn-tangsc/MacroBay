#!/usr/bin/env tsx
/**
 * 「状态判断 × 内容容器」**候选发现器**（不是判决器）。
 *
 * 病：`{state === 'available' ? <表格> : <空态>}` —— 状态判定同时决定「画什么内容」，
 * 于是「读失败」会连表格一起藏掉，而没有一个测试会红。约定已经写死在规范里，这条只负责**报候选**：
 *
 * 1. 命中 JSX 里带 `state` / `status` 条件的三元；
 * 2. 看随后 20 行里有没有内容容器（`<table>` / `<ul>` / `<tbody>` / `<List>` / `rows.map(` / `items.map(`）；
 * 3. **它不判对错**——两枝都是空态组件的、只管一句附注的，都是正常写法。
 *
 * 人看完之后必须**留痕**：在候选上方写一行
 *   `state-ternary: reviewed — <为什么这处没问题>`
 * 假阳性也要写，否则下一轮扫描它还是嫌疑人。没留痕的候选即失败。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const ROOT = resolve(process.cwd())
const SCAN_ROOTS = ['apps/desktop-shell/src', 'products']
const SKIP_DIRS = new Set(['node_modules', 'dist', 'out', 'coverage', '.git', 'build', 'release', 'generated'])

/** 状态判断：只在 JSX 三元里才算候选（`{cond ? (`），排除普通表达式与 if。 */
const STATE_TERNARY = /\{\s*[^}\n]*(?:\.state|\.status|state|status)\s*(?:===|!==)[^}\n]*\?/g
/** 内容容器：出现这些就等于「这块三元在决定一整片内容画不画」。 */
const CONTENT_CONTAINER = /<table\b|<ul\b|<tbody\b|<List\b|rows\.map\(|items\.map\(/
/** 留痕标记：人看过之后的结论。 */
export const REVIEW_MARKER = 'state-ternary: reviewed'

/**
 * 留痕**必须带理由**。
 *
 * 只判「出现过这个词」会留下最坏的一种情况：`// state-ternary: reviewed` 光秃秃一行，扫描器说
 * 「全部已复核」，人以为有人看过，其实什么都没写下来。扫描器能证实的只有「有人写过一行」，
 * 不能证实「他看过」——所以至少要求破折号后面真有内容，让空标记当场算未复核。
 */
const REVIEW_WITH_REASON = /state-ternary: reviewed\s*—\s*\S[^\n]{7,}/

/**
 * 有计划但还没修的候选：`debt: MI-11-R161`。
 *
 * 为什么要有这一档：`reviewed` 表达的是「看过，这里没问题」；可今晚那 10 条里有一条其实是
 * **知道自己有问题、只是还没到修的时候**（注释里写着「迁移时一起改」）。把它写成 `reviewed`
 * 就等于让一条欠账冒充例外，而扫描器会一直说「全部已复核」——欠账从此消失。
 * 所以欠账单独一档：**照报、不判红、单独计数**，让「还没修」这件事在输出里一直看得见。
 */
const DEBT_MARKER = /debt:\s*(MI-[\w-]*R\d+)/

export type Candidate = {
  file: string
  line: number
  source: string
  /** 已复核（写了理由）或已记为欠账——两者都不判红。 */
  reviewed: boolean
  /** 记为欠账时带上台账行号，输出里逐条列出来。 */
  debt?: string
}

function codeLines(text: string): string[] {
  return text.split('\n')
}

export function findCandidates(file: string, text: string): Candidate[] {
  const lines = codeLines(text)
  const found: Candidate[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (!STATE_TERNARY.test(line)) continue
    STATE_TERNARY.lastIndex = 0
    const windowText = lines.slice(index, index + 20).join('\n')
    if (!CONTENT_CONTAINER.test(windowText)) continue
    // 留痕可以写在候选上方 3 行内（注释通常紧贴上面），也可以在同一行尾。
    const nearby = lines.slice(Math.max(0, index - 3), index + 1).join('\n')
    const debt = DEBT_MARKER.exec(nearby)?.[1]
    found.push({
      file,
      line: index + 1,
      source: line.trim().slice(0, 120),
      // 欠账与例外都不判红：一个是「还没修」，一个是「不用修」，但两者都不许冒充对方。
      reviewed: debt !== undefined || REVIEW_WITH_REASON.test(nearby),
      ...(debt === undefined ? {} : { debt })
    })
  }
  return found
}

/**
 * 欠账行号必须在台账里真实存在。
 *
 * `debt: MI-11-R999` 这种写错的号码比不写更糟：它看起来有人管，实际指向一行不存在的东西，
 * 永远不会有人来修。台账是 gitignore 的本地文件，读不到时**不判红**（CI 上没有它），
 * 但要明说「本次没校验」，不让「没查」冒充「查过了」。
 */
export function unknownDebtRows(candidates: readonly Candidate[], knownRows: ReadonlySet<string>): string[] {
  return candidates
    .map((candidate) => candidate.debt)
    .filter((debt): debt is string => debt !== undefined && !knownRows.has(debt))
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
    if (statSync(full).isDirectory()) {
      sourceFiles(full, out)
      continue
    }
    if (!/\.tsx$/.test(name) || /\.test\.tsx$/.test(name)) continue
    out.push(full)
  }
  return out
}

/** 台账里出现过哪些行号。读不到就返回 null（CI 上没有 docs-private），由调用方明说「没校验」。 */
function knownBacklogRows(): Set<string> | null {
  const path = join(ROOT, 'docs-private', 'iterations', 'BACKLOG.md')
  try {
    const text = readFileSync(path, 'utf8')
    return new Set([...text.matchAll(/MI-[\w-]*R\d+/g)].map((match) => match[0]))
  } catch {
    return null
  }
}

function main(): void {
  const files = SCAN_ROOTS.flatMap((root) => sourceFiles(join(ROOT, root)))
  const candidates = files.flatMap((file) => findCandidates(relative(ROOT, file), readFileSync(file, 'utf8')))
  const unreviewed = candidates.filter((candidate) => !candidate.reviewed)
  const debts = candidates.filter((candidate) => candidate.debt !== undefined)

  const backlogRows = knownBacklogRows()
  const unknownDebts = backlogRows === null ? [] : unknownDebtRows(candidates, backlogRows)

  if (unreviewed.length === 0 && unknownDebts.length === 0) {
    const reviewed = candidates.length - debts.length
    console.log(`state-content-ternary: ${candidates.length} candidate(s), ${reviewed} reviewed, ${debts.length} debt.`)
    for (const candidate of debts) {
      console.log(`  debt ${candidate.debt}  ${candidate.file}:${candidate.line}`)
    }
    if (backlogRows === null) {
      console.log('  （台账不在本机，本轮没有校验 debt 行号是否真实存在）')
    }
    return
  }

  if (unknownDebts.length > 0) {
    console.error(`state-content-ternary: ${unknownDebts.length} 处 debt 指向台账里不存在的行，等于没人会来修：`)
    for (const candidate of candidates.filter((entry) => entry.debt !== undefined && unknownDebts.includes(entry.debt))) {
      console.error(`  ${candidate.file}:${candidate.line}  debt: ${candidate.debt}`)
    }
  }

  if (unreviewed.length > 0) {
    console.error(`state-content-ternary: ${unreviewed.length} unreviewed candidate(s) — 状态判定在决定整片内容画不画：`)
    for (const candidate of unreviewed) {
      console.error(`  ${candidate.file}:${candidate.line}  ${candidate.source}`)
    }
    console.error(`  看过之后在候选上方写一行 \`${REVIEW_MARKER} — <为什么这处没问题>\`；假阳性也要写。`)
    console.error('  有计划但还没修的，写 `debt: MI-11-R<行号>`——照报、不判红，但要有人在台账里认领它。')
    console.error('  约定：内容按数据长度渲染（rows.length > 0 ? 内容 : 空态），不用状态位藏内容。')
  }
  process.exit(1)
}

if (process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '')) {
  main()
}
