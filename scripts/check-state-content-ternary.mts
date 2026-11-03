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

export type Candidate = { file: string; line: number; source: string; reviewed: boolean }

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
    found.push({ file, line: index + 1, source: line.trim().slice(0, 120), reviewed: REVIEW_WITH_REASON.test(nearby) })
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
    if (statSync(full).isDirectory()) {
      sourceFiles(full, out)
      continue
    }
    if (!/\.tsx$/.test(name) || /\.test\.tsx$/.test(name)) continue
    out.push(full)
  }
  return out
}

function main(): void {
  const files = SCAN_ROOTS.flatMap((root) => sourceFiles(join(ROOT, root)))
  const candidates = files.flatMap((file) => findCandidates(relative(ROOT, file), readFileSync(file, 'utf8')))
  const unreviewed = candidates.filter((candidate) => !candidate.reviewed)

  if (unreviewed.length === 0) {
    console.log(
      `state-content-ternary: ${candidates.length} candidate(s), all reviewed.`
    )
    return
  }

  console.error(`state-content-ternary: ${unreviewed.length} unreviewed candidate(s) — 状态判定在决定整片内容画不画：`)
  for (const candidate of unreviewed) {
    console.error(`  ${candidate.file}:${candidate.line}  ${candidate.source}`)
  }
  console.error(`  看过之后在候选上方写一行 \`${REVIEW_MARKER} — <为什么这处没问题>\`；假阳性也要写。`)
  console.error('  约定：内容按数据长度渲染（rows.length > 0 ? 内容 : 空态），不用状态位藏内容。')
  process.exit(1)
}

if (process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '')) {
  main()
}
