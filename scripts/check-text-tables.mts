import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/**
 * 壳层「读屏名解析用哪几张文案表」的清单校验。
 *
 * 清单本身在 `apps/desktop-shell/src/renderer/src/i18n/textTableRegistry.ts`：每个条目是
 * `模块路径 + 导出名`。这份脚本只做一件机械的事——**清单里写的东西真的存在**：
 * 文件在不在、导出名在不在。表改名或删掉而清单没跟上，这里就红；否则清单会慢慢变成一张
 * 写着已不存在文件的废纸，而守卫拿着空集合一路绿。
 *
 * 语义那一半（每张表在中英两套都能解析）在 vitest 守卫里跑，跟 `pnpm test` 同步：
 * `apps/desktop-shell/src/renderer/src/i18n/ariaLabelKeyGuard.test.ts`。
 */
const ROOT = resolve(process.cwd())
const REGISTRY = join(ROOT, 'apps/desktop-shell/src/renderer/src/i18n/textTableRegistry.ts')

export type RegistryEntry = Readonly<{ id: string; module: string; exportName: string }>

/** 从清单源码里取出条目（不 import：脚本要能在表本身写坏时也跑得起来）。 */
export function entriesIn(source: string): RegistryEntry[] {
  const entries: RegistryEntry[] = []
  const pattern = /id:\s*'([^']+)',\s*module:\s*'([^']+)',\s*exportName:\s*'([^']+)'/g
  for (const match of source.matchAll(pattern)) {
    entries.push({ id: match[1] ?? '', module: match[2] ?? '', exportName: match[3] ?? '' })
  }
  return entries
}

/** 解析模块路径到文件（相对清单文件所在目录）。 */
export function moduleFile(registryPath: string, modulePath: string): string {
  const base = dirname(registryPath)
  const candidate = resolve(base, modulePath)
  for (const file of [`${candidate}.ts`, `${candidate}.tsx`, join(candidate, 'index.ts'), join(candidate, 'index.tsx')]) {
    if (existsSync(file)) return file
  }
  return ''
}

export type Problem = Readonly<{ id: string; why: string }>

export function problemsIn(registryPath: string, source: string): Problem[] {
  const problems: Problem[] = []
  const entries = entriesIn(source)
  if (entries.length === 0) problems.push({ id: '(清单)', why: '一个条目都没解析到——清单格式变了或内容被删空' })
  for (const entry of entries) {
    const file = moduleFile(registryPath, entry.module)
    if (file === '') {
      problems.push({ id: entry.id, why: `模块不存在：${entry.module}` })
      continue
    }
    const text = readFileSync(file, 'utf8')
    const exported = new RegExp(`export\\s+(?:const|let|var|function|class)\\s+${entry.exportName}\\b|export\\s*\\{[^}]*\\b${entry.exportName}\\b`, 'u')
    if (!exported.test(text)) problems.push({ id: entry.id, why: `${entry.module} 里没有导出 ${entry.exportName}` })
  }
  return problems
}

const source = readFileSync(REGISTRY, 'utf8')
const problems = problemsIn(REGISTRY, source)
if (problems.length > 0) {
  console.error('文案表清单未通过：')
  for (const problem of problems) console.error(`  ${problem.id} — ${problem.why}`)
  process.exit(1)
}
console.log(`文案表清单通过：${entriesIn(source).length} 个条目，模块与导出名都在。`)
