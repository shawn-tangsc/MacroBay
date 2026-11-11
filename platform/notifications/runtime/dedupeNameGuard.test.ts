import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * 事件声明里的 `dedupeKeyTemplate` 占位符，必须与**提交点**实际给出的 `dedupeVars.vars` 键同名。
 *
 * 为什么要有这条守卫：2026-11-11 手动与自动两条路一起哑掉，原因是声明写
 * `analysis:{triggerKey}:{cutoff}`，而共用的构造器发的是 `vars: { bucket, cutoff }`——平台展开的
 * 是**声明**里的模板，`{triggerKey}` 留在原地，整条被按 `missing-dedupe-key` 拒收。修一次不够：
 * 同一个坑换一个事件就能再踩一遍，所以判据要机械。
 *
 * 判法：① 从各产品的 manifest 里取「事件 id → 模板占位符」；② 从源码里取「提交点 → 事件 id + vars 键」
 * （`eventTypeId` 用字面量或常量表展开）；③ 每个提交点的键必须覆盖它那条模板的每个占位符。
 * 事件 id 解析不出来的提交点跳过并报数——宁可少判，不可误判。
 */
const ROOT = process.cwd()
const SKIP = new Set(['node_modules', 'out', 'dist', 'build', 'coverage', 'release', '.git', '.scratch'])

function files(dir: string, match: (name: string) => boolean, out: string[] = []): string[] {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of names) {
    if (SKIP.has(name)) continue
    const absolute = join(dir, name)
    if (statSync(absolute).isDirectory()) files(absolute, match, out)
    else if (match(name)) out.push(absolute)
  }
  return out
}

const read = (file: string): string => readFileSync(file, 'utf8')
const placeholdersOf = (template: string): readonly string[] => [...template.matchAll(/\{(\w+)\}/gu)].map(match => match[1]!)

/** 声明侧：事件 id → 模板里的占位符名。 */
function declaredTemplates(): ReadonlyMap<string, readonly string[]> {
  const declared = new Map<string, readonly string[]>()
  for (const file of files(join(ROOT, 'products'), name => name.endsWith('product.manifest.ts'))) {
    const source = read(file)
    // `notificationEvent('id', { … dedupeKeyTemplate: '…' … })`
    for (const match of source.matchAll(/notificationEvent(?:<[^>]*>)?\('([^']+)',\s*\{/gu)) {
      const rest = source.slice(match.index! + match[0].length)
      const template = rest.match(/dedupeKeyTemplate:\s*'([^']+)'/u)
      if (template === null) continue
      declared.set(match[1]!, placeholdersOf(template[1]!))
    }
  }
  for (const file of files(join(ROOT, 'platform'), name => name.endsWith('platformNotificationEvents.ts'))) {
    const source = read(file)
    for (const match of source.matchAll(/\{\s*id:\s*'([^']+)',([\s\S]*?)\n\s{2}\}/gu)) {
      const template = match[2]!.match(/dedupeKeyTemplate:\s*'([^']+)'/u)
      if (template === null) continue
      declared.set(match[1]!, placeholdersOf(template[1]!))
    }
  }
  return declared
}

/** 常量表：`analysisConclusion: 'market-intelligence.analysis.conclusion'`。 */
function eventIdConstants(): ReadonlyMap<string, string> {
  const constants = new Map<string, string>()
  for (const file of files(join(ROOT, 'products'), name => name.endsWith('notificationEventKeys.ts'))) {
    for (const match of read(file).matchAll(/(\w+):\s*'([a-z0-9-]+\.[a-z0-9.-]+)'/gu)) constants.set(match[1]!, match[2]!)
  }
  return constants
}

export type SubmissionSite = Readonly<{ file: string; eventId: string; keys: readonly string[] }>

/** 提交侧：同一段代码里同时有 `eventTypeId` 与 `dedupeVars: { builder: 'template', vars: {...} }`。 */
export function submissionSites(): readonly SubmissionSite[] {
  const sites: SubmissionSite[] = []
  const constantOf = eventIdConstants()
  for (const root of ['products', 'apps', 'platform']) {
    for (const file of files(join(ROOT, root), name => (name.endsWith('.ts') || name.endsWith('.tsx')) && !name.includes('.test.'))) {
      const source = read(file)
      for (const match of source.matchAll(/dedupeVars:\s*\{\s*builder:\s*'template',\s*vars:\s*\{([^}]*)\}/gu)) {
        // 键有两种写法：`triggerKey: …` 与简写 `{ storyKey }`。两种都是真的键名。
        const keys = match[1]!
          .split(',')
          .map(part => part.trim())
          .filter(part => part.length > 0 && !part.startsWith('...'))
          .map(part => (part.includes(':') ? part.slice(0, part.indexOf(':')).trim() : part))
          .filter(name => /^\w+$/u.test(name))
        // 事件 id 与 vars 通常隔着几行（同一个请求对象里），取前文一段窗口。
        const window = source.slice(Math.max(0, match.index - 1500), match.index)
        const literal = [...window.matchAll(/eventTypeId:\s*'([^']+)'/gu)].at(-1)?.[1]
        const constant = [...window.matchAll(/eventTypeId:\s*[\w.]*?([A-Za-z_]\w*)\s*[,}\n]/gu)].at(-1)?.[1]
        const eventId = literal ?? (constant === undefined ? undefined : constantOf.get(constant))
        if (eventId === undefined) continue
        sites.push({ file: relative(ROOT, file), eventId, keys })
      }
    }
  }
  return sites
}

/**
 * 源码里出现过的**所有** `vars: {...}` 键（不管事件 id 认不认得出）。
 *
 * 为什么还要这一份：去重变量常常在**共用构造器**里拼、`eventTypeId` 写在调用点，两者不在同一段代码里。
 * 只按「同一段代码」判会漏掉这种形状——2026-11-11 那一笔正好是这种。
 */
export function allVarsKeys(): readonly string[] {
  const keys = new Set<string>()
  for (const root of ['products', 'apps', 'platform']) {
    for (const file of files(join(ROOT, root), name => (name.endsWith('.ts') || name.endsWith('.tsx')) && !name.includes('.test.'))) {
      for (const match of read(file).matchAll(/vars:\s*\{([^}]*)\}/gu)) {
        for (const part of match[1]!.split(',')) {
          const name = part.includes(':') ? part.slice(0, part.indexOf(':')).trim() : part.trim()
          if (/^\w+$/u.test(name)) keys.add(name)
        }
      }
    }
  }
  return [...keys]
}

describe('a dedupe template and the vars its producer sends use one name', () => {
  it('finds the declared templates and the submission sites (the guard is looking at real code)', () => {
    expect(declaredTemplates().size).toBeGreaterThan(5)
    expect(submissionSites().length).toBeGreaterThan(5)
  })

  it('has a submission somewhere that gives every placeholder of each declared template', () => {
    // 共用构造器里拼 vars、调用点写 eventTypeId 的形态只能这样判：每个占位符名都必须在某个 vars 里出现过。
    const keys = new Set(allVarsKeys())
    const missing = [...declaredTemplates()].flatMap(([eventId, placeholders]) =>
      placeholders.filter(name => !keys.has(name)).map(name => `${eventId} 缺 ${name}`))
    expect(missing).toEqual([])
  })

  it('gives every submission site the placeholders its own template names', () => {
    const declared = declaredTemplates()
    const offenders: string[] = []
    for (const site of submissionSites()) {
      const placeholders = declared.get(site.eventId)
      if (placeholders === undefined) continue
      const missing = placeholders.filter(name => !site.keys.includes(name))
      if (missing.length > 0) offenders.push(`${site.eventId} (${site.file}) 缺 ${missing.join(', ')}；实发 ${site.keys.join(', ')}`)
    }
    expect(offenders).toEqual([])
  })
})
