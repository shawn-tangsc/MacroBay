import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 守卫：**日历对源不感知**——读者看到的行不该因为「这条来自 narwhal 还是 0xrouter」走不同
 * 逻辑。允许出现源名的地方只有：采集适配（每个源自己的目录）、注册表、以及「按源选值」的
 * 读数链（新源优先、旧源回退）。**新增一处就要在基线里登记并写理由**，改动因此可审。
 *
 * 四种写法都计数（只认单引号是「出生即绿」——最常见的形状恰好是常量比较）：
 *   1. `'narwhal'` / `"narwhal"` / 模板串；2. `marketCalendarProviderId` 等常量名；
 *   3. `macro-calendar-narwhal` / `-0xrouter` 前缀串。
 *
 * 范围：`service/intelligence/macro-calendar/**`、`desktop/**`、`contracts/**`。
 * 豁免**逐项列出**（设置页、i18n 源显示名），不用「整个 desktop 跳过」这种一刀切。
 *
 * 基线与本用例同一笔提交；不带基线就是出生即红的门禁。
 */
const PRODUCT = new URL('../../../', import.meta.url).pathname
const ROOTS = ['service/intelligence/macro-calendar', 'desktop', 'contracts']
const PATTERN = /(['"`])(narwhal|0xrouter)\1|marketCalendarProviderId|marketCalendarLegacyProviderId|macro-calendar-narwhal|macro-calendar-0xrouter/g
const BASELINE = new URL('./__baselines__/source-literals.json', import.meta.url).pathname

function files(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '__baselines__') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) { out.push(...files(full)); continue }
    if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) out.push(full)
  }
  return out
}

describe('源名字面量守卫', () => {
  it('新增一处源名分支必须同时登记基线（四种写法都算）', () => {
    const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as
      { files: Record<string, { count: number }>, exempt: { path: string }[] }
    const exempt = baseline.exempt.map((item) => item.path)
    const current: Record<string, number> = {}
    for (const root of ROOTS) {
      for (const file of files(join(PRODUCT, root))) {
        const rel = relative(PRODUCT, file)
        if (exempt.some((prefix) => rel.startsWith(prefix))) continue
        const hits = readFileSync(file, 'utf8').match(PATTERN)
        if (hits) current[rel] = hits.length
      }
    }
    const growth = Object.entries(current)
      .filter(([rel, count]) => count > (baseline.files[rel]?.count ?? 0))
      .map(([rel, count]) => `${rel}: ${baseline.files[rel]?.count ?? 0} → ${count}`)
    expect(growth, `源名用法新增，必须在 __baselines__/source-literals.json 登记并写理由：\n${growth.join('\n')}`)
      .toEqual([])
  })
})
