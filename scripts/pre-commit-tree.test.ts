import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { materializeCommitTree, readDeletedPaths } from './pre-commit-tree.mts'

/**
 * 钩子「落树」这一步的回归用例。
 *
 * 钉的是两条方向都能红的判据：**只提交调用方**时，被调模块在树里必须是 **HEAD 那一版**（于是类型红）；
 * **被调模块先提交**时，同一笔调用方必须通过。审查一个永远绿的门禁没有意义。
 */
const dirs: string[] = []

function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function makeRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'pre-commit-tree-test-'))
  dirs.push(dir)
  git(dir, ['init', '-q', '-b', 'main'])
  git(dir, ['config', 'user.email', 'test@example.com'])
  git(dir, ['config', 'user.name', 'Test'])
  // 临时仓库不继承开发机的全局 eol 设置：`core.autocrlf=true` 时 `checkout-index` 会把 LF 写成 CRLF，
  // 于是这些断言在 Windows 上量到的是 git 的换行转换，不是落树逻辑。仓库自己的 `.gitattributes` 管不到这里。
  git(dir, ['config', 'core.autocrlf', 'false'])
  writeFiles(dir, files)
  git(dir, ['add', '.'])
  git(dir, ['commit', '-q', '-m', 'base'])
  return dir
}

function writeFiles(cwd: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(cwd, path, '..'), { recursive: true })
    writeFileSync(join(cwd, path), content)
  }
}

/** 落树到临时目录，返回该目录。 */
function materialize(cwd: string, staged: readonly string[]): string {
  const treeRoot = mkdtempSync(join(tmpdir(), 'pre-commit-tree-out-'))
  dirs.push(treeRoot)
  materializeCommitTree({ cwd, treeRoot, staged, deleted: readDeletedPaths(cwd) })
  return treeRoot
}

/** 用仓库自带的 tsc 查这棵树里指定的两个文件；返回是否通过。 */
function typechecks(treeRoot: string, files: readonly string[]): boolean {
  const config = join(treeRoot, 'tsconfig.check.json')
  writeFileSync(config, JSON.stringify({
    compilerOptions: { strict: true, noEmit: true, target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler' },
    files: [...files]
  }))
  const result = (() => {
    try {
      // `.bin/tsc` 在 Windows 上是 sh 脚本（真正可执行的是 `tsc.cmd`），execFile 不走 PATHEXT，
      // 直接调用必然 ENOENT——那会被这里读成「类型检查没通过」，于是判据在 Windows 上恒假。
      // 用 node 跑 tsc 的入口文件，三种平台同一个写法。
      execFileSync(process.execPath, [join(process.cwd(), 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit', '-p', config], { encoding: 'utf8' })
      return true
    } catch {
      return false
    }
  })()
  rmSync(config)
  return result
}

const BASE_A = "import { label } from './b'\nexport const show = (): string => label\n"
const BASE_B = "export const label = 'ok'\n"
/** A 用上 B 的新字段：只提交 A 时，树里的 B 必须还是旧版，于是这里是真的坏。 */
const NEW_A = "import { label, extra } from './b'\nexport const show = (): string => `${label}:${extra}`\n"
const NEW_B = "export const label = 'ok'\nexport const extra = 'detail'\n"

describe('提交树落盘', () => {
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('只提交调用方时，被调模块保持 HEAD 那一版（依赖新字段就是真的坏的）', () => {
    const repo = makeRepo({ 'a.ts': BASE_A, 'b.ts': BASE_B })
    writeFiles(repo, { 'a.ts': NEW_A, 'b.ts': NEW_B })
    git(repo, ['add', 'a.ts'])

    const tree = materialize(repo, ['a.ts'])

    // 关键事实：树里的 b.ts 必须是 HEAD 版，而不是工作区那份。
    expect(readFileSync(join(tree, 'b.ts'), 'utf8')).toBe(BASE_B)
    expect(readFileSync(join(tree, 'a.ts'), 'utf8')).toBe(NEW_A)
    // 因此这次提交真的过不了类型检查——门禁应当拦。
    expect(typechecks(tree, ['a.ts', 'b.ts'])).toBe(false)
  })

  it('被调模块先提交之后，同一笔调用方通过', () => {
    const repo = makeRepo({ 'a.ts': BASE_A, 'b.ts': BASE_B })
    writeFiles(repo, { 'b.ts': NEW_B })
    git(repo, ['add', 'b.ts'])
    git(repo, ['commit', '-q', '-m', 'b gains a field'])

    writeFiles(repo, { 'a.ts': NEW_A })
    git(repo, ['add', 'a.ts'])
    const tree = materialize(repo, ['a.ts'])

    // 这次 HEAD 里已经有新版 b.ts，树是完整且自洽的。
    expect(readFileSync(join(tree, 'b.ts'), 'utf8')).toBe(NEW_B)
    expect(typechecks(tree, ['a.ts', 'b.ts'])).toBe(true)
  })

  it('HEAD 里其它文件也在这棵树里（不只是这一笔的路径）', () => {
    const repo = makeRepo({ 'a.ts': BASE_A, 'b.ts': BASE_B, 'docs/note.md': 'hello' })
    writeFiles(repo, { 'a.ts': NEW_A })
    git(repo, ['add', 'a.ts'])

    const tree = materialize(repo, ['a.ts'])

    // 缺了这些文件，按目录扫的守卫会报「找不到 products/**」这类假红。
    expect(readFileSync(join(tree, 'docs', 'note.md'), 'utf8')).toBe('hello')
    expect(readFileSync(join(tree, 'b.ts'), 'utf8')).toBe(BASE_B)
  })

  it('工具缺席时钩子明说「没有检查」，不静默放行', () => {
    // 临时仓库里没有 node_modules：生成器/tsc 都缺席。钩子必须打出一行明确的「没有检查」并放行——
    // **静默通过是最坏的一种绿**，读者会以为这一笔被查过。
    const repo = makeRepo({ 'a.ts': BASE_A })
    writeFiles(repo, { 'a.ts': `${BASE_A}
export const more = 1\n` })
    git(repo, ['add', 'a.ts'])

    // 同上：`.bin/tsx` 在 Windows 上不是可执行入口，用 node 直接跑它的 cli，才能拿到真实退出码。
    const result = spawnSync(process.execPath, [join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs'), join(process.cwd(), 'scripts', 'pre-commit.mts')], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, SKIP_PRE_COMMIT: undefined, PRE_COMMIT_BUDGET_MS: '20000' }
    })
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`

    expect(result.status).toBe(0)
    expect(output).toContain('没有检查')
  })

  it('删除的路径不会留在树里', () => {
    const repo = makeRepo({ 'a.ts': BASE_A, 'b.ts': BASE_B })
    rmSync(join(repo, 'b.ts'))
    git(repo, ['add', '-A'])

    const tree = materialize(repo, ['b.ts'])
    expect(() => readFileSync(join(tree, 'b.ts'), 'utf8')).toThrow()
  })
})
