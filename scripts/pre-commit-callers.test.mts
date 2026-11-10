import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { findCallers } from './pre-commit-callers.mts'

/**
 * 反向依赖：钩子必须能找到「程序之外引用这一笔文件的人」。
 *
 * 2026-11-10 的 B4 事故：`ProviderDetail` 的 props 加了必填 `health`，看板抽屉
 * （`DashboardPanelDrawer.tsx:164`）没改，`TS2741` 进了链。钩子当时 9.7s、预算 58s——不是超时，
 * 是 `files` 里只有本次提交的文件，调用方根本不在程序里。
 *
 * 这里的用例照着那次事故的形状写：提交里的文件被谁引用，谁就必须被找到；
 * 「找到了但没进程序」由 `pre-commit-reverse-dependency.test.mts` 用真 tsc 证明会红。
 */

const temporary: string[] = []
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  temporary.push(dir)
  return dir
}

function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

function gitRepository(files: Record<string, string>): string {
  const dir = tempDir('pre-commit-callers-')
  git(dir, ['init', '--quiet'])
  git(dir, ['config', 'user.email', 'test@example.test'])
  git(dir, ['config', 'user.name', 'test'])
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), content)
  }
  git(dir, ['add', '--all'])
  return dir
}

afterEach(() => {
  while (temporary.length > 0) rmSync(temporary.pop() as string, { recursive: true, force: true })
})

describe('reverse dependencies', () => {
  it('finds a caller that imports the staged file, and only the caller', () => {
    const cwd = gitRepository({
      'Widget.ts': 'export type WidgetProps = { label: string }\n',
      'Caller.ts': "import { WidgetProps } from './Widget'\nexport type Props = WidgetProps\n",
      'Unrelated.ts': 'export const nothing = 1\n'
    })

    expect(findCallers({ cwd, staged: ['Widget.ts'] }).callers).toEqual(['Caller.ts'])
  })

  it('matches an import that spells out the extension', () => {
    const cwd = gitRepository({
      'Widget.ts': 'export type WidgetProps = { label: string }\n',
      'Caller.ts': "import type { WidgetProps } from './Widget.ts'\nexport type Props = WidgetProps\n"
    })

    expect(findCallers({ cwd, staged: ['Widget.ts'] }).callers).toEqual(['Caller.ts'])
  })

  it('ignores a path that is only mentioned in a comment', () => {
    // 真实撞到的形状：`mergeShellNavigation.test.ts` 的注释里写了 `scripts/pre-commit.mts`，
    // 被当成调用方拖进程序，白跑了一整片该测试的 import 图。
    const cwd = gitRepository({
      'Widget.ts': 'export const widget = 1\n',
      'Note.ts': "// 见 `scripts/Widget.ts` 那段\nexport const note = 1\n"
    })

    expect(findCallers({ cwd, staged: ['Widget.ts'] }).callers).toEqual([])
  })

  it('does not report files that are already in the commit', () => {
    const cwd = gitRepository({
      'Widget.ts': 'export type WidgetProps = { label: string }\n',
      'Caller.ts': "import { WidgetProps } from './Widget'\nexport type Props = WidgetProps\n"
    })

    expect(findCallers({ cwd, staged: ['Widget.ts', 'Caller.ts'] }).callers).toEqual([])
  })

  it('does not treat an index file as a stem, so directory imports do not pull the whole tree', () => {
    const cwd = gitRepository({
      'settings/index.ts': 'export const settings = 1\n',
      'settings/leaf.ts': 'export const leaf = 1\n',
      'Caller.ts': "import { settings } from './settings'\nexport const value = settings\n"
    })

    expect(findCallers({ cwd, staged: ['settings/index.ts'] }).callers).toEqual([])
  })

  it('stops at one layer: callers of callers are not dragged in', () => {
    const cwd = gitRepository({
      'Widget.ts': 'export const widget = 1\n',
      'Caller.ts': "import { widget } from './Widget'\nexport const value = widget\n",
      'Second.ts': "import { value } from './Caller'\nexport const second = value\n"
    })

    expect(findCallers({ cwd, staged: ['Widget.ts'] }).callers).toEqual(['Caller.ts'])
  })

  it('caps the callers it hands to the typecheck and says how many it left out', () => {
    const cwd = gitRepository({
      'Widget.ts': 'export const widget = 1\n',
      'A.ts': "import { widget } from './Widget'\nexport const a = widget\n",
      'B.ts': "import { widget } from './Widget'\nexport const b = widget\n",
      'C.ts': "import { widget } from './Widget'\nexport const c = widget\n"
    })

    expect(findCallers({ cwd, staged: ['Widget.ts'], limit: 2 })).toEqual({
      callers: ['A.ts', 'B.ts'],
      skipped: 1
    })
  })
})

describe('the B4 incident', () => {
  /** 事故那一笔真实改过的文件（`3e49d15`，用 git 读，免得清单随重构漂移）。 */
  const incidentCommit = '3e49d15'

  it('finds the dashboard drawer as a caller of the component it broke', () => {
    const repository = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
    const staged = execFileSync('git', ['show', '--name-only', '--format=', incidentCommit], {
      cwd: repository,
      encoding: 'utf8'
    })
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')

    const { callers } = findCallers({ cwd: repository, staged })

    // 这一条就是当时漏掉的那个宿主：它没进程序，TS2741 才进了链。
    expect(callers).toContain('products/market-intelligence/desktop/pages/intelligence/DashboardPanelDrawer.tsx')
    // 提交里的文件不该被当成调用方（它们是根）。
    expect(callers.filter((path) => staged.includes(path))).toEqual([])
  })
})
