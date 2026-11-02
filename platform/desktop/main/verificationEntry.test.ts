import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * 验证入口只能有一处定义。
 *
 * 今天的错不是「忘了跑某一步」，是本来就有三处清单：`AGENTS.md` 写三条、关账跑了四条、CI 跑了五条。
 * 按文档跑就会漏掉没人写的那一条。所以这里不写「以后请保持一致」，而是读四个文件、断言它们指向同一个命令：
 * 谁加了一步只改一处，这个测试就红。
 */

import { VERIFY_CHECKS, compareSamples, countDirty, type TreeSample } from '../../../scripts/verify-sample'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const read = (relativePath: string): string => readFileSync(`${ROOT}${relativePath}`, 'utf8')

/**
 * 检查清单现在**只有一个来源**：`scripts/verify-run.mts` 的 `CHECKS`。
 *
 * 之前这里复制了一整条 `&&` 链，于是每加一步要改四处（package.json、CI、AGENTS、这里）。
 * 执行器抽走后，`package.json` 只指向它，这份测试断言的是「三处都指向那唯一一份清单」。
 */
const RUNNER = 'tsx scripts/verify-run.mts'

/** `ci.yml` 里所有单行 `run:` 的值。安装步不算检查，单独排掉。 */
function ciRunSteps(): string[] {
  const ci = read('.github/workflows/ci.yml')
  const steps: string[] = []
  for (const line of ci.split('\n')) {
    const match = line.match(/^\s*run:\s*(\S.*)$/u)
    if (match) steps.push(match[1].trim())
  }
  return steps
}

/** 取某个二级标题到下一个二级标题之间的正文。 */
function markdownSection(markdown: string, heading: string): string {
  const start = markdown.indexOf(`\n${heading}\n`)
  if (start === -1) return ''
  const from = start + heading.length + 2
  const next = markdown.indexOf('\n## ', from)
  return next === -1 ? markdown.slice(from) : markdown.slice(from, next)
}

describe('verification entry', () => {
  it('points package.json at the one runner, and keeps the chain inside it', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts?: Record<string, string> }
    expect(pkg.scripts?.verify).toBe(RUNNER)
    expect(pkg.scripts?.['verify:sole']).toBe(`${RUNNER} --strict`)
    // 清单本身仍然存在，且顺序就是 CI 曾经跑的那一份。
    expect([...VERIFY_CHECKS]).toEqual([
      'docs:check',
      'check:file-size',
      'check:danger-color',
      'check:hex-color',
      'check:undefined-token',
      'check:components-ownership',
      'check:async-initial-state',
      'check:state-content-ternary',
      'typecheck',
      'test',
      'build'
    ])
  })

  it('lets CI run that script instead of listing the checks itself', () => {
    const checks = ciRunSteps().filter((step) => step !== 'pnpm install --frozen-lockfile')
    // 一处且只有一处调 `pnpm verify`：CI 不得再各列一份检查清单。
    expect(checks).toEqual(['pnpm verify'])
  })

  it('keeps AGENTS.md pointing at the script and free of a second list', () => {
    // `AGENTS.md` 与 `docs-private` 一样被 gitignore：CI 里没有它，本地才有，所以缺席时只验存在的情况。
    if (!existsSync(`${ROOT}AGENTS.md`)) return
    const section = markdownSection(read('AGENTS.md'), '## Verification')
    expect(section).toContain('pnpm verify')
    // 旧清单必须真的删掉：留着两份清单，读者会挑短的那份照做。
    for (const stale of ['pnpm docs:check', 'pnpm check:file-size', 'pnpm typecheck', 'pnpm test', 'pnpm build']) {
      expect(section).not.toContain(stale)
    }
  })

  it('keeps AGENTS.md step list equal to the verify chain, not just in name', () => {
    // `AGENTS.md` 被 gitignore：`git archive` 出来的快照里没有它，本地才有。缺席时跳过，
    // 否则这条守卫会让「按提交打快照签字」这件事失败在一个与仓库状态无关的原因上。
    if (!existsSync(`${ROOT}AGENTS.md`)) return
    // 旧守卫只禁止「第二份带 `pnpm` 前缀的清单」：有人把清单改写成不带前缀的写法，它就一直绿着过期。
    // 它证明的从来是「没有第二份清单」，不是「这份清单是对的」——所以这里比步骤本身。
    const chain = ['verify:preflight', ...VERIFY_CHECKS, 'verify:postflight']
    const section = markdownSection(read('AGENTS.md'), '## Verification')
    const listedLine = section.split('\n').find((line) => line.includes(' → ') && line.includes('`'))
    expect(listedLine, 'AGENTS.md no longer lists the steps').toBeTruthy()
    // 只取 `checks:` 之后那一串：同一行前面还有反引号包着的 `verify`，它不属于步骤列表。
    const chainText = (listedLine as string).slice((listedLine as string).indexOf('checks:'))
    const listed = [...chainText.matchAll(/`([^`]+)`/gu)].map((match) => match[1])

    expect(listed).toEqual(chain)
  })

  it('keeps the release run from checking less than the daily run', () => {
    // 发版那一跑是「更严的那一跑」：它拒绝脏树、且只认 valid 的收尾采样。
    // 它**绝不能少查一项**——绿了也不代表发出去的这批查过那一项。
    // 现在两条链共用一个执行器与同一份清单，差别只有 `--strict` 这个开关：
    // 唯一能造成"发版少查一项"的路，是执行器里按 `--strict` 分支改变清单——所以这里直接读执行器源码。
    const pkg = JSON.parse(read('package.json')) as { scripts?: Record<string, string> }
    const runnerSource = read('scripts/verify-run.mts')

    expect(pkg.scripts?.verify).toBe('tsx scripts/verify-run.mts')
    expect(pkg.scripts?.['verify:sole']).toBe('tsx scripts/verify-run.mts --strict')
    // 清单只出现一次，且循环本身不带条件：`--strict` 只影响 preflight/postflight 的参数。
    expect(runnerSource.match(/VERIFY_CHECKS/gu)).toHaveLength(2)
    expect(runnerSource).not.toMatch(/strict[^\n]*VERIFY_CHECKS|VERIFY_CHECKS[^\n]*strict/u)
    expect(runnerSource).toContain("strict ? ['--strict'] : []")
  })

  it('keeps the private release gates on the same command', () => {
    const releaseProcess = `${ROOT}docs-private/10-development/release-process.md`
    // `docs-private` 被 gitignore，CI 里没有这些文件；本地才有，所以缺席时只验有它的情况。
    if (!existsSync(releaseProcess)) return
    const text = read('docs-private/10-development/release-process.md')
    expect(text).toContain('pnpm verify')
    expect(text).not.toContain('pnpm docs:check && pnpm typecheck')
  })

describe('verify sampling', () => {
  const sample = (head: string, dirty: number, at = '2026-11-02T00:00:00.000Z'): TreeSample => ({ head, dirty, at })

  it('accepts a run only when both samples describe the same tree', () => {
    const clean = compareSamples(sample('abc1234', 0), sample('abc1234', 0))
    expect(clean).toMatchObject({ verdict: 'valid', attributable: true })

    // 首尾都脏、但一致：稳定，但**不能归因**——它必须是一个不同的词，否则有人会拿这行绿去关账。
    const stableDirty = compareSamples(sample('abc1234', 3), sample('abc1234', 3))
    expect(stableDirty).toMatchObject({ verdict: 'polluted', attributable: false })
    expect(stableDirty.reason).toMatch(/dirty/)
  })

  it('calls a run invalid when someone commits or edits while it runs', () => {
    // 这两种就是今晚实际发生的：起跑后有人提交（head 变）或有人在写（dirty 变）。
    expect(compareSamples(sample('abc1234', 0), sample('def5678', 0))).toMatchObject({ verdict: 'invalid', attributable: false })
    expect(compareSamples(sample('abc1234', 0), sample('abc1234', 4))).toMatchObject({ verdict: 'invalid' })
    // 两个都变，仍然是 invalid，而且理由先报 head——那是更好定位的那个。
    expect(compareSamples(sample('abc1234', 0), sample('def5678', 2)).reason).toMatch(/HEAD moved/)
  })

  it('refuses to attest a tree it cannot see, instead of guessing', () => {
    expect(compareSamples(sample('no-git', -1), sample('no-git', -1))).toMatchObject({ verdict: 'unknown', attributable: false })
    expect(compareSamples(sample('abc1234', 0), sample('no-git', -1)).verdict).toBe('unknown')
    // 四种结论两两不同：一个词只表示一件事。
    const words = new Set([
      compareSamples(sample('a', 0), sample('a', 0)).verdict,
      compareSamples(sample('a', 2), sample('a', 2)).verdict,
      compareSamples(sample('a', 0), sample('b', 0)).verdict,
      compareSamples(sample('no-git', -1), sample('no-git', -1)).verdict
    ])
    expect(words.size).toBe(4)
  })
})

  it('counts files, not collapsed directories, so a file added mid-run is visible', () => {
    // `git status --porcelain` 默认把未跟踪目录折叠成一行 `?? dir/`：跑中有人往**已存在的**
    // 未跟踪目录里再加三个文件，`dirty` 计数不变，漂移就漏了。`-uall` 才逐文件列。
    const folded = '?? newdir/'
    const expanded = '?? newdir/a.ts\n?? newdir/b.ts'
    expect(countDirty(folded)).toBe(1)
    expect(countDirty(expanded)).toBe(2)
    // 反向：折叠下的 1 与展开后的 2 是两个不同的 dirty，`compareSamples` 因此会判 invalid。
    const at = (dirty: number): TreeSample => ({ head: 'abc1234', dirty, at: '2026-11-02T00:00:00.000Z' })
    expect(compareSamples(at(1), at(2))).toMatchObject({ verdict: 'invalid' })
    // 守卫同时钉住命令本身：谁把 `-uall` 去掉，这条红。
    const source = readFileSync(`${ROOT}scripts/verify-sample.ts`, 'utf8')
    expect(source).toContain("'status', '--porcelain', '-uall'")
  })
})
