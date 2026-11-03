import { readFileSync } from 'node:fs'
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
 * 判据只有一句，而且它**不随新增漂移**：`package.json` 里的每个 script 都必须有一个落点。
 *
 *   ① `verify` 链里（含起点/终点采样与执行器）
 *   ② 发布流水线里直接调（`.github/workflows/*.yml`）
 *   ③ `scripts/manual-only-checks.md` 里（人工跑，写明为什么不能自动）
 *   ④ 开发入口白名单（真正每天手敲的那几个，**只减不增**）
 *
 * 外加两条自动规则：被已接上的脚本调用（`pnpm <key>` 出现在它的命令里）跟着一起算接上；
 * `pre<x>` 是 npm 的生命周期钩子，`x` 接上了它就接上了。
 *
 * 为什么不再按前缀（`check:` / `docs:` …）判：前缀每加一个就得回来改一次正则，而且"哪些前缀该管"
 * 永远说不清。按落点判，新增任何前缀都不需要改守卫——**没有落点就红**。
 */

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const read = (relativePath: string): string => readFileSync(`${ROOT}${relativePath}`, 'utf8')

/**
 * 清单的位置**必须在版本库里**：它住在 `docs-private/`（gitignore）时，本机绿、干净快照红——
 * 守卫自己成了"只在某人机器上成立"的东西。放在 `scripts/` 是因为它描述的就是这些脚本，
 * 而且它不能进 `docs/`：那里的公开文档要求中英成对。
 */
const MANUAL_ONLY_DOC = 'scripts/manual-only-checks.md'

/**
 * 入口本身不算「一个检查」：`verify` 就是那条链，`verify:sole` 是它的严格版入口。
 * 它们要是也参与「必须被接上」的判定，就会变成自己要求自己——那是同义反复，不是守卫。
 * 其余 `verify:*`（例如 `verify:preflight`）仍然按检查算：它必须真的在链里。
 */
const ENTRY_KEYS = new Set(['verify', 'verify:sole'])

const WORKFLOWS = ['.github/workflows/ci.yml', '.github/workflows/release.yml']

/**
 * ④ 开发入口白名单：**真正每天手敲的那几个**，它们不需要"谁来跑"，因为人就在敲。
 *
 * 判据不是"它看起来像开发命令"，而是：**它不进链、不进流水线、也不是需要证据的手动检查，
 * 但有人会主动敲它**。一个没人敲的条目留在这里，就是给孤儿开后门。
 *
 * **这份名单只减不增。** 下面有一条断言把上限钉死：加一行必须同时把那个数字加一，
 * 于是评审一定看得见"我们又给了谁一个不用被调用的资格"。
 */
const DEV_ENTRIES: ReadonlyArray<readonly [key: string, why: string]> = [
  ['dev', '每天都开：起开发窗口'],
  ['lint', '公开文档写明的别名，等价于 typecheck（链里已经有 typecheck），留给人手敲'],
  ['dist:mac', '维护者手敲的打包命令'],
  ['dist:mac:dir', '维护者手敲的打包命令（只出目录，不打包）'],
  ['dist:win', '维护者手敲的打包命令'],
  ['dist:win:dir', '维护者手敲的打包命令（只出目录，不打包）'],
  ['release:bump', '发版第一步，发布流程里写死'],
]
const DEV_ENTRIES_CEILING = DEV_ENTRIES.length

/** 别的脚本里怎么调用另一个脚本：`pnpm <key>` 或 `pnpm run <key>`。 */
const PNPM_CALL = /\bpnpm\s+(?:run\s+)?([a-zA-Z][\w:-]*)/gu

function calledBy(text: string): string[] {
  return [...text.matchAll(PNPM_CALL)].map((match) => match[1])
}

/** ② 流水线里直接调的脚本；只认 `package.json` 里真实存在的键，忽略 `pnpm install` 这类。 */
function workflowKeys(scriptKeys: ReadonlySet<string>): string[] {
  const found = new Set<string>()
  for (const file of WORKFLOWS) {
    for (const key of calledBy(read(file))) if (scriptKeys.has(key)) found.add(key)
  }
  return [...found]
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

/**
 * manual-only 清单里声明的键：表格里以 `pnpm <key>` 形式出现。
 *
 * 文件不在就**直接红**，不再当作"清单为空"：早先那行 `if (!existsSync) return []` 会把
 * "清单被删了/根本没进快照"翻译成"一个都没声明"，于是所有键一起变孤儿——红得很响，但指向错的地方。
 */
function manualOnlyKeys(): string[] {
  const text = read(MANUAL_ONLY_DOC)
  return [...text.matchAll(/`pnpm\s+([^`\s]+)`/gu)].map((match) => match[1])
}

describe('verification scripts are all wired somewhere', () => {
  it('gives every script a landing, so none of them runs nowhere', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts?: Record<string, string> }
    const scripts = pkg.scripts ?? {}
    const keys = new Set(Object.keys(scripts))

    // 链的唯一来源是 `VERIFY_CHECKS`：`package.json` 里已经没有那条 `&&` 长串了。
    const wired = new Set<string>([
      ...VERIFY_CHECKS,
      ...ENTRY_KEYS,
      ...runnerSteps(),
      ...workflowKeys(keys),
      ...manualOnlyKeys(),
      ...DEV_ENTRIES.map(([key]) => key)
    ])

    // 传递闭包：被已接上的脚本调用的，也算接上；`pre<x>` 跟着 `x`。跑到不再变化为止。
    for (let changed = true; changed;) {
      changed = false
      const calls = new Set<string>()
      for (const key of wired) for (const called of calledBy(scripts[key] ?? '')) calls.add(called)
      for (const key of keys) {
        if (wired.has(key)) continue
        const hookBase = key.startsWith('pre') ? key.slice('pre'.length) : null
        if (calls.has(key) || (hookBase !== null && wired.has(hookBase))) {
          wired.add(key)
          changed = true
        }
      }
    }

    // 差集要能直接读：说清楚是哪些键、以及四条出路分别是什么。
    const orphans = [...keys].filter((key) => !wired.has(key)).sort()
    expect(
      orphans,
      `这些脚本没有任何落点（写了、没人跑、也没人能发现它没人跑）：\n` +
        `${orphans.map((key) => `  - ${key}`).join('\n')}\n` +
        '四条出路：① 进 verify 链；② 让流水线直接调它；③ 写进 ' +
        `${MANUAL_ONLY_DOC}；④ 它是真的每天手敲的开发入口，进 DEV_ENTRIES。`
    ).toEqual([])
  })

  it('keeps the dev-entry allowlist honest: real scripts, no overlap, and it only shrinks', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts?: Record<string, string> }
    const scripts = pkg.scripts ?? {}
    const keys = new Set(Object.keys(scripts))

    // ① 名单里的每个键必须真的存在，否则它守的是一个已经不存在的命令。
    const missing = DEV_ENTRIES.map(([key]) => key).filter((key) => !keys.has(key))
    expect(missing, `DEV_ENTRIES 里这些键在 package.json 里已经不存在：\n${missing.join('\n')}`).toEqual([])

    // ② 已经被别处接上的，不许再进白名单：那等于用白名单给孤儿发通行证。
    const wiredElsewhere = new Set<string>([
      ...VERIFY_CHECKS,
      ...ENTRY_KEYS,
      ...runnerSteps(),
      ...workflowKeys(keys),
      ...manualOnlyKeys()
    ])
    const redundant = DEV_ENTRIES.map(([key]) => key).filter((key) => wiredElsewhere.has(key))
    expect(redundant, `这些键已经有落点了，不该再算「开发入口」：\n${redundant.join('\n')}`).toEqual([])

    // ③ 上限钉死：加一行必须同时改这个数字，评审看得见。
    expect(
      DEV_ENTRIES.length,
      'DEV_ENTRIES 只减不增：确实要加一个开发入口，就把这个上限一起加一，并写清为什么它不需要落点。'
    ).toBeLessThanOrEqual(DEV_ENTRIES_CEILING)
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
