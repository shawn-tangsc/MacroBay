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
 * **i18n 只放行「紧跟冒号」的出现**（`'narwhal':`、`'macro-calendar-narwhal-…':`）：源 id 只许
 * 当键，不许当显示值——哪天某个值忽然是 `narwhal`，读者就会在界面上直接看到它。
 *
 * 基线与本用例同一笔提交；不带基线就是出生即红的门禁。
 */
const PRODUCT = new URL('../../../', import.meta.url).pathname
const ROOTS = ['service/intelligence/macro-calendar', 'desktop', 'contracts']
const PATTERN = /(['"`])(?:narwhal|0xrouter|Narwhal|0xRouter)\1|marketCalendarProviderId|marketCalendarLegacyProviderId|marketCalendarSourceName|macro-calendar-narwhal|macro-calendar-0xrouter/g
/** i18n 里出现在**值位置**的源名：整串结尾不是冒号。 */
const I18N_VALUE_PATTERN = /(['"`])(?:(?!\1).)*(?:narwhal|0xrouter|Narwhal|0xRouter)(?:(?!\1).)*\1(?!\s*:)/g
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

describe('源名字面量守卫', () => {
  it('新增一处源名分支必须同时登记基线（四种写法 + .tsx + i18n 值位置）', () => {
    const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as { files: Record<string, { count: number }> }
    const current: Record<string, number> = {}
    for (const root of ROOTS) {
      for (const file of files(join(PRODUCT, root))) {
        const rel = relative(PRODUCT, file)
        const source = readFileSync(file, 'utf8')
        const hits = rel.includes('shared/i18n/') ? (source.match(I18N_VALUE_PATTERN) ?? []).length
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
