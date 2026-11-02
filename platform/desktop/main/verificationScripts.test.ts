import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { VERIFY_CHECKS } from '../../../scripts/verify-sample'

/**
 * 第四处清单：**脚本本身有没有被接上**。
 *
 * `verificationEntry.test.ts` 管的是「`package.json` / `ci.yml` / `AGENTS.md` / 发布门禁四处一致」；
 * 本条管的是另一件事：`package.json` 里写了一堆检查，**其中有没有谁从来没被调用过**。
 *
 * 今晚就是这么发现三个孤儿的：`check:boot-page`、`demo:verify`、`channel:acceptance`——定义在，
 * 却不在 `verify`、不在 CI、不在发布流程里。它们不是"备用"，是**写完之后没人跑**。
 *
 * 判据只有一句：**每个检查要么在 `verify` 链里，要么在 manual-only 清单里**。
 * 第三种状态（写了、既没进链也没进清单）就是这次要禁掉的。
 */

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const read = (relativePath: string): string => readFileSync(`${ROOT}${relativePath}`, 'utf8')

/** 与 `package.json` 里的命名约定一致：这三类都算「一个检查」。 */
const CHECK_PREFIXES = ['check:', 'verify', 'demo:verify', 'acceptance']

const MANUAL_ONLY_DOC = 'docs-private/10-development/manual-only-checks.md'

/**
 * 入口本身不算「一个检查」：`verify` 就是那条链，`verify:sole` 是它的严格版入口。
 * 它们要是也参与「必须被接上」的判定，就会变成自己要求自己——那是同义反复，不是守卫。
 * 其余 `verify:*`（例如 `verify:preflight`）仍然按检查算：它必须真的在链里。
 */
const ENTRY_KEYS = new Set(['verify', 'verify:sole'])

function isCheckKey(key: string): boolean {
  if (ENTRY_KEYS.has(key)) return false
  if (key.startsWith('check:')) return true
  if (key.startsWith('verify:')) return true
  if (key === 'demo:verify') return true
  return key.includes('acceptance')
}

/** 执行器：链、起点采样、终点采样都在它里面，`package.json` 只指向它。 */
const RUNNER = 'scripts/verify-run.mts'
const CHAIN_SOURCE = 'scripts/verify-sample.ts'

/**
 * 执行器直接跑的两步采样。它们**不在** `VERIFY_CHECKS` 里（那不是检查，是「这次结果属于哪棵树」），
 * 但确实被调用，所以按执行器源码里有没有出现来判定——删掉一行调用，这里立刻不再算它被接上。
 */
function runnerSteps(): string[] {
  const text = read(RUNNER)
  return ['preflight', 'postflight']
    .filter((name) => text.includes(`scripts/verify-${name}.mts`))
    .map((name) => `verify:${name}`)
}

/** manual-only 清单里声明的键：表格里以 `pnpm <key>` 形式出现。 */
function manualOnlyKeys(): string[] {
  if (!existsSync(`${ROOT}${MANUAL_ONLY_DOC}`)) return []
  const text = read(MANUAL_ONLY_DOC)
  return [...text.matchAll(/`pnpm\s+([^`\s]+)`/gu)].map((match) => match[1])
}

describe('verification scripts are all wired somewhere', () => {
  it('has no check script that neither runs in verify nor is declared manual-only', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts?: Record<string, string> }
    const keys = Object.keys(pkg.scripts ?? {}).filter(isCheckKey)
    // 链的唯一来源是 `VERIFY_CHECKS`：`package.json` 里已经没有那条 `&&` 长串了。
    const wired = new Set<string>([...VERIFY_CHECKS, ...runnerSteps(), ...manualOnlyKeys()])

    // 差集要能直接读：说清楚是哪些键、以及两条出路各自是什么。
    const orphans = keys.filter((key) => !wired.has(key)).sort()
    expect(
      orphans,
      `这些脚本写了，但既不在 \`verify\` 链里、也不在 ${MANUAL_ONLY_DOC} 里：\n` +
        `${orphans.map((key) => `  - ${key}`).join('\n')}\n` +
        '给它们一条出路：能进 verify 的进 verify；需要真机/产物/凭据的，写进 manual-only 清单。'
    ).toEqual([])
  })

  it('keeps every manual-only key a real script, so the list cannot rot', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts?: Record<string, string> }
    const scripts = pkg.scripts ?? {}
    // 清单里写了一个已经不存在的脚本，同样要红：它会让下一个人以为那个检查还在跑。
    const dangling = manualOnlyKeys().filter((key) => scripts[key] === undefined)
    expect(
      dangling,
      `manual-only 清单里这些键在 package.json 里已经不存在了：\n${dangling.map((key) => `  - ${key}`).join('\n')}`
    ).toEqual([])
  })

  it('samples the tree before and after the checks, and offers a strict entry', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts?: Record<string, string> }
    // 两个入口都必须走执行器：链只有一份，谁再写一条 `&&` 长串，就不再是这棵树上的那个链。
    expect(pkg.scripts?.verify).toBe(`tsx ${RUNNER}`)
    // 封版用的严格入口必须真的带 `--strict`，否则它与 warn 版没有区别。
    expect(pkg.scripts?.['verify:sole']).toBe(`tsx ${RUNNER} --strict`)

    // 起点必须在检查之前、终点必须在检查之后：跑前断言证明「跑在哪棵树上」，跑后就失去意义；
    // 终点无论如何都要采一次，否则一次红会被默认钉在起点那个提交上。
    const runner = read(RUNNER)
    const start = runner.indexOf('scripts/verify-preflight.mts')
    // 找那个循环，不找 import：`VERIFY_CHECKS` 在文件头出现过一次，按名字找会命中 import。
    const checks = runner.indexOf('for (const check of VERIFY_CHECKS)')
    const end = runner.indexOf('scripts/verify-postflight.mts')
    expect(start, `${RUNNER} 里没有调用起点采样`).toBeGreaterThanOrEqual(0)
    expect(checks, `${RUNNER} 里没有遍历 ${CHAIN_SOURCE} 的链`).toBeGreaterThanOrEqual(0)
    expect(end, `${RUNNER} 里没有调用终点采样`).toBeGreaterThanOrEqual(0)
    expect(start).toBeLessThan(checks)
    expect(checks).toBeLessThan(end)
    expect(pkg.scripts?.['verify:preflight']).toBe('tsx scripts/verify-preflight.mts')
  })
})
