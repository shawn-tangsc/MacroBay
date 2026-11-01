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

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const read = (relativePath: string): string => readFileSync(`${ROOT}${relativePath}`, 'utf8')

const VERIFY_SCRIPT =
  'pnpm docs:check && pnpm check:file-size && pnpm check:danger-color && pnpm check:hex-color && pnpm typecheck && pnpm test && pnpm build'

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
  it('defines one verify script in package.json, in the order CI used to run', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts?: Record<string, string> }
    expect(pkg.scripts?.verify).toBe(VERIFY_SCRIPT)
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

  it('keeps the private release gates on the same command', () => {
    const releaseProcess = `${ROOT}docs-private/10-development/release-process.md`
    // `docs-private` 被 gitignore，CI 里没有这些文件；本地才有，所以缺席时只验有它的情况。
    if (!existsSync(releaseProcess)) return
    const text = read('docs-private/10-development/release-process.md')
    expect(text).toContain('pnpm verify')
    expect(text).not.toContain('pnpm docs:check && pnpm typecheck')
  })
})
