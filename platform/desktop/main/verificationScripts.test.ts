import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

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

/** `verify` 链里直接调用的键（按 `&&` 切，取 `pnpm <key>`）。嵌套的 `verify:preflight` 也算一个键。 */
function verifyChain(pkg: { scripts?: Record<string, string> }): string[] {
  const script = pkg.scripts?.verify ?? ''
  return script
    .split('&&')
    .map((step) => step.trim())
    .map((step) => /^pnpm\s+(\S+)$/u.exec(step)?.[1])
    .filter((key): key is string => key !== undefined)
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
    const wired = new Set([...verifyChain(pkg), ...manualOnlyKeys()])

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

  it('keeps the preflight in front of the chain, and offers a strict entry', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts?: Record<string, string> }
    // 跑前断言必须在链首：它要证明的是「这次结果跑在哪棵树上」，跑在最后就失去意义。
    expect(verifyChain(pkg)[0]).toBe('verify:preflight')
    expect(pkg.scripts?.['verify:preflight']).toBe('tsx scripts/verify-preflight.mts')
    // 封版用的严格入口必须真的带 `--strict`，否则它与 warn 版没有区别。
    expect(pkg.scripts?.['verify:sole']).toContain('scripts/verify-preflight.mts --strict')
  })
})
