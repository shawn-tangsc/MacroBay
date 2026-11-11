import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { REQUIRED_ASSETS, collectAssets, planPublish, releaseCommands } from './publish-release.mts'

/**
 * 发布作业的自测：**不发布**也要能证明「它取的东西都在」。
 *
 * 0.4.2 第一次发版红在 `publish`：作业只下载产物、不检出仓库，却去仓库里读发布正文，于是
 * `missing release body` 退 1。这套机制 01:35 合入、从未被真标签跑过。所以这里守两条：
 *
 * 1. **计划**：少一件必需产物就报名字（不是空目录里发一个缺件的 Release）；
 * 2. **取用**：脚本只读 `--dist`，从一个没有 checkout 的目录里也能跑完——这正是 0.4.2 的反面。
 *
 * 第二条是行为证据，不是读源码猜：把 cwd 换到一个空临时目录里跑真脚本，未来谁再往里加一句
 * 「去仓库里找文件」，这条会当场红。
 */

const SCRIPT = fileURLToPath(new URL('./publish-release.mts', import.meta.url))
const WORKFLOW = fileURLToPath(new URL('../../.github/workflows/release.yml', import.meta.url))

const temporary: string[] = []
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  temporary.push(dir)
  return dir
}

function distWith(names: readonly string[]): string {
  const dir = tempDir('publish-release-dist-')
  for (const name of names) writeFileSync(join(dir, name), '')
  return dir
}

afterEach(() => {
  while (temporary.length > 0) rmSync(temporary.pop() as string, { recursive: true, force: true })
})

describe('publish plan', () => {
  it('collects every asset the three build jobs upload', () => {
    const distDir = distWith([...REQUIRED_ASSETS, 'MacroBay-x64.dmg.blockmap', 'notes.txt'])
    const plan = planPublish({ distDir, tag: 'v0.4.3' })

    expect(plan.version).toBe('0.4.3')
    // 三个安装器 + 两套更新清单：少一件就是缺件的 Release。
    for (const required of REQUIRED_ASSETS) expect(plan.assets).toContain(required)
    // blockmap 也要跟着上传（自动更新的增量包靠它），但它不是「必需件」：缺了照样能发。
    expect(plan.assets).toContain('MacroBay-x64.dmg.blockmap')
    // 不是产物的文件不许混进上传清单（`find` 那条老 shell 是按后缀挑的，这里也是一样）。
    expect(plan.assets).not.toContain('notes.txt')
  })

  it('names the missing asset instead of publishing a partial release', () => {
    const distDir = distWith(REQUIRED_ASSETS.filter((name) => name !== 'MacroBay-x64.dmg'))
    expect(() => planPublish({ distDir, tag: 'v0.4.3' })).toThrow(
      /missing release asset: MacroBay-x64\.dmg/u
    )
  })

  it('refuses a directory it was never handed', () => {
    expect(() => collectAssets(join(tmpdir(), 'publish-release-does-not-exist'))).toThrow(
      /dist directory does not exist/u
    )
  })

  it('refuses a ref that is not a version tag', () => {
    const distDir = distWith(REQUIRED_ASSETS)
    expect(() => planPublish({ distDir, tag: 'chore/test-cleanup' })).toThrow(/invalid release tag/u)
  })

  it('runs from a directory without a checkout, so it cannot depend on repository files', () => {
    const distDir = distWith(REQUIRED_ASSETS)
    const workdir = tempDir('publish-release-no-checkout-')

    // 真脚本、真空 cwd：这里没有 docs/、没有 package.json，只有一个 dist/。
    const stdout = execFileSync(process.execPath, [SCRIPT, '--dist', distDir, '--tag', 'v0.4.3', '--dry-run'], {
      cwd: workdir,
      encoding: 'utf8'
    })

    expect(stdout).toContain('publish plan for v0.4.3')
    expect(stdout).toContain('MacroBay-x64.dmg')
    expect(stdout).toContain('dry run: no Release was created or changed')
  })

  it('validates in dry-run too, so a green dry run cannot print a partial plan', () => {
    const distDir = distWith(REQUIRED_ASSETS.filter((name) => name !== 'latest.yml'))
    const result = spawnSync(
      process.execPath,
      [SCRIPT, '--dist', distDir, '--tag', 'v0.4.3', '--dry-run'],
      { encoding: 'utf8' }
    )

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('missing release asset: latest.yml')
    // 计划都没过，就不许先打印一段“看起来没问题”的命令。
    expect(result.stdout).not.toContain('publish plan')
  })

  it('prints the exact command it would run, for both a new and an existing release', () => {
    const distDir = distWith(REQUIRED_ASSETS)
    const created = execFileSync(
      process.execPath,
      [SCRIPT, '--dist', distDir, '--tag', 'v0.4.3', '--dry-run', '--exists'],
      { encoding: 'utf8' }
    )
    expect(created).toContain('gh release upload v0.4.3 --clobber')
    expect(created).toContain('leave the body alone')

    const fresh = execFileSync(process.execPath, [SCRIPT, '--dist', distDir, '--tag', 'v0.4.3', '--dry-run'], {
      encoding: 'utf8'
    })
    expect(fresh).toContain('gh release create v0.4.3')
    expect(fresh).toContain('--notes-file /dev/null')
    expect(fresh).toContain('--verify-tag')
  })

  /* 0.4.3 第一次真标签红在 `gh release create ... latest-mac.yml`：命令里只有裸文件名，
     而这些文件在 `--dist` 目录里，发布作业又从仓库根跑——于是 `no matches found` 退 1。
     上面那条用例当时是绿的，因为它只比较字符串。这条改成**逐个打开**命令里的每个附件：
     名字对、但文件打不开，就是红。 */
  it('points every uploaded file at a path that can actually be opened', () => {
    const distDir = distWith(REQUIRED_ASSETS)
    const plan = planPublish({ distDir, tag: 'v0.4.3' })

    for (const exists of [false, true]) {
      const [command] = releaseCommands(plan, { exists })
      const files = command.slice(Math.max(command.indexOf('--verify-tag'), command.indexOf('--clobber')) + 1)
      expect(files, 'every required asset must be passed').toHaveLength(REQUIRED_ASSETS.length)
      for (const file of files) expect(existsSync(file), `cannot open ${file}`).toBe(true)
    }
  })

  /* `--self-test` 是发布作业在 `workflow_dispatch` 里的自检入口，但此前**没有任何地方跑它**：
     它自己坏了也不会有人知道。这里让每次 `npm test` 都真跑一遍——齐了能计划、缺件报得出名字。 */
  it('runs its own self-test: a complete dist plans, a missing asset is named', () => {
    const out = execFileSync(process.execPath, [SCRIPT, '--self-test'], { encoding: 'utf8' })
    expect(out).toContain('publish self-test OK')
    expect(out).toContain('a missing asset is reported by name')
  })
})

/**
 * workflow 守卫：**读仓库文件的作业必须自己检出仓库**。
 *
 * 这条规则就是 0.4.2 那次红的原因；把当时的形状写成一个合成样本，证明这个判定真的会红，
 * 而不是一条「跑在现在的文件上永远绿」的同义反复。
 */

interface JobBlocks {
  readonly [job: string]: string
}

function jobBlocks(workflow: string): JobBlocks {
  const lines = workflow.split('\n')
  const jobsAt = lines.indexOf('jobs:')
  if (jobsAt < 0) throw new Error('release.yml has no jobs: section')

  const blocks: Record<string, string[]> = {}
  let current: { name: string; body: string[] } | null = null
  for (const line of lines.slice(jobsAt + 1)) {
    const header = /^ {2}([A-Za-z0-9_-]+):\s*$/u.exec(line)
    if (header !== null) {
      if (current !== null) blocks[current.name] = current.body
      current = { name: header[1], body: [line] }
      continue
    }
    if (/^\S/u.test(line)) break
    current?.body.push(line)
  }
  if (current !== null) blocks[current.name] = current.body
  return Object.fromEntries(Object.entries(blocks).map(([name, body]) => [name, body.join('\n')]))
}

const REPOSITORY_PATH = /(?:(?:docs|scripts)\/[A-Za-z0-9._$~{}/-]+|package\.json|pnpm-lock\.yaml)/gu

/** 作业里真实会去读的仓库路径（注释不算：注释不读文件）。 */
function repositoryPaths(job: string): string[] {
  const code = job
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n')
  return [...new Set(code.match(REPOSITORY_PATH) ?? [])]
}

function jobsReadingRepositoryWithoutCheckout(workflow: string): { job: string; paths: string[] }[] {
  return Object.entries(jobBlocks(workflow))
    .map(([job, body]) => ({ job, body, paths: repositoryPaths(body) }))
    .filter(({ body, paths }) => paths.length > 0 && !body.includes('actions/checkout@'))
    .map(({ job, paths }) => ({ job, paths }))
}

/** 0.4.2 出事时的形状：没有 checkout，却在 run 里读仓库里的正文。 */
const BROKEN_PUBLISH_JOB = [
  'jobs:',
  '  publish:',
  '    name: Publish GitHub Release',
  '    needs: [macos, macos-x64, windows]',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - name: Download installers',
  '        uses: actions/download-artifact@v4',
  '      - name: Publish the release',
  '        run: |',
  '          body="docs/reference/release-notes/${version}.release-body.md"',
  '          test -f "$body" || { echo "missing release body: $body" >&2; exit 1; }'
].join('\n')

describe('release workflow keeps what it reads inside the job', () => {
  it('goes red on the shape that failed 0.4.2', () => {
    expect(jobsReadingRepositoryWithoutCheckout(BROKEN_PUBLISH_JOB)).toEqual([
      { job: 'publish', paths: ['docs/reference/release-notes/${version}.release-body.md'] }
    ])
  })

  it('finds no such job in the real workflow', () => {
    expect(jobsReadingRepositoryWithoutCheckout(readFileSync(WORKFLOW, 'utf8'))).toEqual([])
  })

  it('never reintroduces the repository-owned release body', () => {
    // 注释里写事故经过是允许的（它不读文件）；这里只看真正会执行的代码。
    const code = readFileSync(WORKFLOW, 'utf8')
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n')
    expect(code).not.toMatch(/release-notes|release-body/u)
  })

  it('checks out the script and downloads the artifacts the plan validates', () => {
    const publish = jobBlocks(readFileSync(WORKFLOW, 'utf8')).publish
    expect(publish, 'publish job must exist').toBeDefined()
    expect(publish).toContain('actions/checkout@')
    expect(publish).toContain('scripts/release/publish-release.mts')
    expect(publish).toContain('pattern: macrobay-*')
    expect(publish).toContain('merge-multiple: true')
    expect(publish).toContain('--dist dist')
  })

  it('can validate without publishing, through the dispatch input', () => {
    const workflow = readFileSync(WORKFLOW, 'utf8')
    expect(workflow).toMatch(/self_test:/u)
    const publish = jobBlocks(workflow).publish
    expect(publish).toContain('self_test')
    expect(publish).toContain('--dry-run')
  })
})
