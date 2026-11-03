import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  aliasRulesFromTsconfigPaths,
  describeUnresolved,
  findUnresolvedImports,
  parseImportSpecifiers,
  resolveSpecifier,
  type HeadTreeImport
} from './headTreeImports'

/**
 * HEAD 自己引用到的每一份文件，也必须在 HEAD 里。
 *
 * 为什么值得一条常驻用例：今晚同一个形状三次（新文件只在磁盘上、引用它的那一笔照常提交），
 * 每次的代价都不是修改本身，而是**下一个人先证明「不是我改坏的」**——`git archive` 或干净副本
 * 一跑就红一片，而在自己工作区跑类型检查是绿的。判据放在 `pnpm test` 里，这类提交在提交这一步
 * 就会被拦下，不必等到有人从库里取代码。
 *
 * 判据只读 HEAD 视图（`git ls-tree` / `git grep`），不读工作区：工作区里磁盘有、库里没有是常态，
 * 只有 HEAD 上的缺件才是缺陷。
 */

const ROOT = resolve(__dirname, '../..')
const SCANNED_EXTENSIONS = ['*.ts', '*.tsx', '*.mts', '*.mjs', '*.js']

function runGit(args: readonly string[], input?: string): string {
  return execFileSync('git', [...args], {
    cwd: ROOT,
    encoding: 'utf8',
    input,
    maxBuffer: 64 * 1024 * 1024
  })
}

/** `git grep` / `git check-ignore` 用退出码 1 表达「没有」，不是失败。 */
function runGitAllowEmpty(args: readonly string[], input?: string): string {
  try {
    return runGit(args, input)
  } catch (error) {
    const status = (error as { status?: number }).status
    if (status === 1) return (error as { stdout?: string }).stdout ?? ''
    throw error
  }
}

function trackedAtHead(): Set<string> {
  return new Set(
    runGit(['ls-tree', '-r', '--name-only', 'HEAD'])
      .split('\n')
      .filter((path) => path !== '')
  )
}

/** `HEAD:<path>:<line>:<content>`，路径里没有冒号。 */
function importsAtHead(): HeadTreeImport[] {
  const output = runGitAllowEmpty([
    'grep',
    '-n',
    '-I',
    '-E',
    'from |import\\(|require\\(',
    'HEAD',
    '--',
    ...SCANNED_EXTENSIONS
  ])
  const imports: HeadTreeImport[] = []
  for (const raw of output.split('\n')) {
    if (!raw.startsWith('HEAD:')) continue
    const afterRevision = raw.slice('HEAD:'.length)
    const pathEnd = afterRevision.indexOf(':')
    if (pathEnd === -1) continue
    const file = afterRevision.slice(0, pathEnd)
    const afterFile = afterRevision.slice(pathEnd + 1)
    const lineEnd = afterFile.indexOf(':')
    if (lineEnd === -1) continue
    const line = Number(afterFile.slice(0, lineEnd))
    if (!Number.isInteger(line)) continue
    const content = afterFile.slice(lineEnd + 1)
    for (const parsed of parseImportSpecifiers(file, content)) imports.push({ ...parsed, line })
  }
  return imports
}

/**
 * 生成物（`products/generated/*` 等）由 `predev` / `pretypecheck` 现场生成，按设计不入库；
 * 它们没进 HEAD 不是缺件。判据用 `.gitignore` 自己说，不另写一张白名单——
 * 白名单会随时间腐坏，而「被忽略的文件」这个定义和 `git status` 用的是同一份规则。
 */
function ignoredPaths(paths: readonly string[]): Set<string> {
  if (paths.length === 0) return new Set()
  // `-z` 要求 NUL 分隔：用换行喂进去，命令把整块当成一条路径、什么都不返回，
  // 于是生成物全被判成缺件（第一次跑就踩了，20 条假 red 里有 10 条是它）。
  const output = runGitAllowEmpty(['check-ignore', '--no-index', '--stdin', '-z'], `${paths.join('\0')}\0`)
  return new Set(output.split('\0').filter((path) => path !== ''))
}

describe('HEAD 树完整性', () => {
  it('HEAD 里被引用的文件也都在 HEAD 里', () => {
    const paths = JSON.parse(readFileSync(resolve(ROOT, 'tsconfig.json'), 'utf8')) as {
      compilerOptions: { paths: Record<string, string[]> }
    }
    const aliasRules = aliasRulesFromTsconfigPaths(paths.compilerOptions.paths)
    const tracked = trackedAtHead()
    const unresolved = findUnresolvedImports(importsAtHead(), tracked, aliasRules)

    // 解析到磁盘上且被 .gitignore 的那一类先摘掉：它们是生成物，不是缺件。
    const onDisk = new Map<string, string>()
    for (const entry of unresolved) {
      const candidates = resolveSpecifier(entry.file, entry.specifier, aliasRules) ?? []
      const hit = candidates.find((candidate) => existsSync(resolve(ROOT, candidate)))
      if (hit !== undefined) onDisk.set(`${entry.file}:${entry.line}`, hit)
    }
    const ignored = ignoredPaths([...new Set(onDisk.values())])
    const offenders = unresolved.filter((entry) => {
      const hit = onDisk.get(`${entry.file}:${entry.line}`)
      return hit === undefined || !ignored.has(hit)
    })

    expect(offenders.map(describeUnresolved)).toEqual([])
  })
})
