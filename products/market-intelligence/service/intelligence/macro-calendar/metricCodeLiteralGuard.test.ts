import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * 守卫 C｜指标码字面量棘轮（架构师 2026-11-14 规格 §3，Chief 2026-11-14 提了四条要求）。
 *
 * 它挡的是「又一个地方按指标码写死了一行」：今晚换码要人工同步五处，其中四处就是这样长出来的。
 *
 * **这是棘轮，不是行为证明**：它只能挡住新增、逼人写理由，挡不住「布局或取值其实已经不对」。
 * 证明行为的只有守卫 D（换码演练）。
 *
 * 四条规矩（照 Chief 的要求落）：
 * 1. 每一项都写三样：文件、数量、**为什么这个字面量必须在这里**（只写数字的基线没人能判断该不该降）；
 * 2. 双向棘轮：涨了要登记并写理由，**减了也必须同笔把数字改小**——只挡涨的棘轮会养出永远降不下去的数；
 * 3. 只统计生产代码，**不算测试文件**（测试里写码是正常的，算进去会让基线永远降不下来）；
 * 4. 真降到某个数降不动时，把「为什么停在这里」写进 `why`，别留个数字没人知道来历。
 */
const PRODUCT_ROOT = join(process.cwd(), 'products/market-intelligence')
const BASELINE_PATH = join(PRODUCT_ROOT,
  'service/intelligence/macro-calendar/__baselines__/metric-code-literals.json')

/** 指标码的形状是 `US.<测度>.<口径>.<量纲>`：四段起。两段的 `US.CPI` 是发布前缀，不是码。 */
/**
 * 指标码字面量。三条都不能省：
 * - **两种引号都认**：码表数据文件整行重建后是 `"US.CPI.NSA.YOY"`，只认单引号会让 542 行**从统计里消失**，
 *   棘轮于是「192 → 0」——那不是减少，是我们看不见了，比涨了更危险；
 * - **国家前缀不写死 `US`**：现在有 AU/JP/GB/CN 等 30 国的码，只抓 `US.` 等于放过其余国家；
 * - 四段起：两段的 `US.CPI` 是发布前缀，不是码。
 */
const METRIC_LITERAL = /["']((?:[A-Z]{2}|EMU)\.[A-Z0-9_]+(?:\.[A-Z0-9_]+){2,})["']/g

type Baseline = Readonly<{
  note: string
  files: Readonly<Record<string, Readonly<{ count: number; why: string }>>>
}>

/** 递归列出目录下的生产代码文件（`.ts` / `.tsx`，不含测试）。 */
function walkSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = join(directory, entry.name)
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : walkSourceFiles(full)
    // **数据文件也要扫**：码表搬到 JSON 之后，`.ts` 里一个码字面量都没有了；只扫 TS 等于守卫
    // 自己走开了、还显示「0 处」——那是最坏的一种绿。JSON 里同样按同一个正则计数。
    if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx') && !entry.name.endsWith('.json')) return []
    if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.tsx')) return []
    return [full]
  })
}

function baseline(): Baseline {
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Baseline
}

function actualCounts(): Map<string, number> {
  const counts = new Map<string, number>()
  for (const absolute of walkSourceFiles(PRODUCT_ROOT)) {
    const relative = absolute.slice(PRODUCT_ROOT.length + 1)
    const matches = readFileSync(absolute, 'utf8').match(METRIC_LITERAL) ?? []
    if (matches.length > 0) counts.set(relative, matches.length)
  }
  return counts
}

describe('守卫 C：指标码字面量只许降不许涨', () => {
  it('每一项基线都写清「为什么这个字面量必须在这里」', () => {
    for (const [file, entry] of Object.entries(baseline().files)) {
      expect(entry.why.trim().length, `${file} 缺 why`).toBeGreaterThan(0)
      expect(entry.count, `${file} 的数量必须是正整数`).toBeGreaterThan(0)
    }
  })

  it('生产代码里的指标码字面量与基线逐一相等（涨、降都要同笔改这里）', () => {
    const expected = baseline().files
    const actual = actualCounts()
    const differences: string[] = []
    for (const [file, entry] of Object.entries(expected)) {
      const now = actual.get(file) ?? 0
      if (now > entry.count) {
        differences.push(`${file}: ${entry.count} → ${now}（新增了 ${now - entry.count} 处）——`
          + '如果这个字面量真的必须在这里，把它登记进基线并写清理由；如果是换码/概念合并漏了，改代码')
      } else if (now < entry.count) {
        differences.push(`${file}: 基线 ${entry.count} → 现在 ${now}——减少也必须同笔把基线改小`
          + '（只挡涨的棘轮会养出永远降不下去的数）')
      }
    }
    for (const file of actual.keys()) {
      if (expected[file] === undefined) differences.push(`${file}: 新文件出现指标码字面量，必须在基线里登记并写理由`)
    }
    expect(differences.join('\n')).toBe('')
  })
})
