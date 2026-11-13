import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 守卫：**日历对源不感知**——读者看到的行不该因为「这条来自 narwhal 还是 0xrouter」走不同逻辑。
 *
 * 现存用法**全部在基线里、目标是清零**；**新的一处都不许加**。特别注意：不许拿「读数链需要」
 * （新源优先、旧源回退）当理由——那条链正是 S2 要删掉的东西，写进注释就等于给它发了授权。
 *
 * 计数的写法（只有一种写法会被漏掉，所以全部覆盖）：
 *   单引号 / 双引号 / 模板串 / 大写形态 `'Narwhal'`、`'0xRouter'`；
 *   常量名 `marketCalendarProviderId`、`marketCalendarLegacyProviderId`、`marketCalendarSourceName`；
 *   前缀串 `macro-calendar-narwhal`、`macro-calendar-0xrouter`；
 *   数组包含（`['narwhal','0xrouter'].includes(x)`）里的字面量本身也会被计数。
 *
 * **`.tsx` 同样在范围内**：规则说「组件里按源分支就算错」，那就必须真的看组件。
 *
 * **i18n 按「用途」判，不按「键/值位置」判**：源名在文案里是**正当的**，只要这条文案是在告诉
 * 读者「数据来自谁」——设置页的源显示名与开关、来源署名、发布说明。其余（事件名、指标名、
 * 卡片文案、日历行）出现源名就红：那些是读者当作**事实**在读的，夹带来源就是错。
 * 判据一句话：**这条文案是在告诉读者「数据来自谁」吗？** 是 → 允许；否 → 红。
 *
 * 之所以不按「值位置一律红」：那样每加一个源，设置页显示名 + 署名就会同时红，现实里只有
 * 一种走法——顺手把基线调大。**基线一旦被盲调，它就不再是证据了。**
 *
 * 基线与本用例同一笔提交；不带基线就是出生即红的门禁。
 */
const PRODUCT = new URL('../../../', import.meta.url).pathname
const ROOTS = ['service/intelligence/macro-calendar', 'desktop', 'contracts']
const PATTERN = /(['"`])(?:narwhal|0xrouter|Narwhal|0xRouter)\1|marketCalendarProviderId|marketCalendarLegacyProviderId|marketCalendarSourceName|macro-calendar-narwhal|macro-calendar-0xrouter/g
/**
 * i18n 里**不许**出现源名的那类行：只在「显示名映射 / 来源署名 / 发布说明」之外计数。
 * 允许的形状长这样：`'narwhal': 'Narwhal'`（键是源 id、值是它的显示名）、以及含
 * 「Data by」「来源」的署名句。
 */
const I18N_ALLOWED_LINE = /(['"`])[\w.-]*(?:narwhal|0xrouter)[\w.-]*\1\s*:\s*(['"`])[^'"`]*\2|Data by|来源/i
const SOURCE_NAME = /narwhal|0xrouter/i
const BASELINE = new URL('./__baselines__/source-literals.json', import.meta.url).pathname

function files(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '__baselines__') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) { out.push(...files(full)); continue }
    if ((entry.endsWith('.ts') || entry.endsWith('.tsx')) && !/\.test\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

describe('名表不许被挪进盲区', () => {
  it('名称表 / 别名表 / 源串映射表必须落在扫描范围之内', () => {
    const found: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry === 'dist' || entry === 'out') continue
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) { walk(full); continue }
        if (/nameTable|metricNames|alias/i.test(entry) && entry.endsWith('.ts')) found.push(relative(PRODUCT, full))
      }
    }
    walk(PRODUCT)
    // 现在这几张表还在 docs-private 的 CSV 里；S0 落成 .ts 之后必须落在 ROOTS 下。
    // 一旦有人把它挪到 platform/ 或 docs/，它就从扫描范围里消失，等于把最容易出错的地方放进盲区。
    const outside = found.filter((rel) => !ROOTS.some((root) => rel.startsWith(root)))
    expect(outside, `这些名表不在扫描范围内，守卫看不到它们：\n${outside.join('\n')}`).toEqual([])
  })
})

describe('源名字面量守卫', () => {
  it('新增一处源名分支必须同时登记基线（四种写法 + .tsx + i18n 值位置）', () => {
    const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as { files: Record<string, { count: number }> }
    const current: Record<string, number> = {}
    for (const root of ROOTS) {
      for (const file of files(join(PRODUCT, root))) {
        const rel = relative(PRODUCT, file)
        const source = readFileSync(file, 'utf8')
        const hits = rel.includes('shared/i18n/')
          ? source.split('\n').filter((line) => SOURCE_NAME.test(line) && !I18N_ALLOWED_LINE.test(line)).length
          : (source.match(PATTERN) ?? []).length
        if (hits) current[rel] = hits
      }
    }
    const growth = Object.entries(current)
      .filter(([rel, count]) => count > (baseline.files[rel]?.count ?? 0))
      .map(([rel, count]) => `${rel}: ${baseline.files[rel]?.count ?? 0} → ${count}`)
    expect(growth, `源名用法新增，必须在 __baselines__/source-literals.json 登记并写理由：\n${growth.join('\n')}`)
      .toEqual([])
  })
})
