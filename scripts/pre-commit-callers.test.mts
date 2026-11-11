import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
  /** 事故那一笔（`3e49d15`）。 */
  const incidentCommit = '3e49d15'
  /**
   * 事故那一笔真实改过的文件，**逐行照抄** `git show --name-only --format= 3e49d15`。
   *
   * 为什么留一份快照：CI 是浅克隆（`fetch-depth: 1`），那笔提交在 CI 里根本不存在，
   * `git show 3e49d15` 直接 fatal（2026-11-12 的 CI 红就是这一句），守卫便在 CI 里从不生效。
   * 所以——**本机有那笔提交时**，这里断言「快照与真实 diff 逐行相同」（漂移当场红）；
   * **没有时**用快照跑，保证这条守卫在 CI 里也真的在跑，而不是被跳过或改成恒绿。
   * 只在「换锚点」时同步这份快照，不许为了变绿改它。
   */
  const incidentFiles = [
    'products/market-intelligence/desktop/settings/intelligence-sources/ProviderDetail.calendarDetails.test.tsx',
    'products/market-intelligence/desktop/settings/intelligence-sources/ProviderDetail.healthDetail.test.tsx',
    'products/market-intelligence/desktop/settings/intelligence-sources/ProviderDetail.proxyBanner.test.tsx',
    'products/market-intelligence/desktop/settings/intelligence-sources/ProviderDetail.tsx',
    'products/market-intelligence/desktop/settings/intelligence-sources/SourceHealthDetail.test.tsx',
    'products/market-intelligence/desktop/settings/intelligence-sources/SourceHealthDetail.tsx',
    'products/market-intelligence/desktop/settings/intelligence-sources/index.tsx',
    'products/market-intelligence/desktop/settings/intelligence-sources/intelligence-sources.css',
    'products/market-intelligence/desktop/settings/intelligence-sources/intelligenceSourcesPageStates.test.tsx',
    'products/market-intelligence/desktop/settings/intelligence-sources/sourceHealthCells.test.ts',
    'products/market-intelligence/desktop/settings/intelligence-sources/sourceHealthCells.ts',
    'products/market-intelligence/desktop/shared/i18n/text/settings/intelligenceSources.ts'
  ] as const

  /** 事故那一笔改过的文件：能读到真提交就核快照，读不到（浅克隆）就用快照。 */
  const incidentStagedFiles = (repository: string): string[] => {
    let fromGit: string[] | undefined
    try {
      fromGit = execFileSync('git', ['show', '--name-only', '--format=', incidentCommit], {
        cwd: repository,
        encoding: 'utf8'
      })
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '')
    } catch {
      // 浅克隆里没有这笔提交：用快照，不跳过。
      fromGit = undefined
    }
    if (fromGit !== undefined) expect(fromGit).toEqual([...incidentFiles])
    return fromGit ?? [...incidentFiles]
  }

  /**
   * 锚点为什么换了（2026-11-11）：
   *
   * 原来钉的是 `pages/intelligence/DashboardPanelDrawer.tsx`——事故当时**没被一起改**的那个宿主。
   * 那个文件后来在「抽屉改造成配置抽屉」那一轮被删了，于是 `findCallers` 永远返回不了它，
   * 用例恒红。**保护本身没有过期**（下面那条 `staged` 不含调用方的断言、以及「只找一层」
   * 「注释里的路径不算」几条另有专门用例钉着），过期的是「拿哪一笔真实事故作锚」。
   *
   * 现在的锚是 `SourceConfigSurface.tsx`：它是 `ProviderDetail` 今天真实的宿主，且**不在**
   * `3e49d15` 的清单里——和当年那个宿主的处境完全一样（组件改了、它没改，所以它必须被拉进程序）。
   * 如果它将来也被删/改名，这条会先在下面那句 `existsSync` 上红，并直接告诉下一个人「换一个真实调用方」，
   * 而不是给一句「expected [...] to include ...」让人当成 flaky 重跑。
   */
  it('finds the host that renders the component it broke', () => {
    const host = 'products/market-intelligence/desktop/settings/intelligence-sources/SourceConfigSurface.tsx'
    const repository = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
    const staged = incidentStagedFiles(repository)

    // 锚点文件必须真实存在：删了/改名了就换一个真实调用方，别让这条守卫无声失效。
    expect(existsSync(join(repository, host)), `锚点调用方不存在了：${host}，请换一个今天真实的调用方`).toBe(true)

    const { callers } = findCallers({ cwd: repository, staged })

    // 这一条就是「组件改了、它没改」的那个宿主：它没进程序，类型错才会进链。
    expect(callers).toContain(host)
    // 提交里的文件不该被当成调用方（它们是根）。
    expect(callers.filter((path) => staged.includes(path))).toEqual([])
  })
})
