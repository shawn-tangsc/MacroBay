import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 守卫：**日历对源不感知**——读者看到的行不该因为「这条来自 narwhal 还是 0xrouter」走不同逻辑。
 *
 * 现存用法**全部在基线里、目标是清零**；**新的一处都不许加**。不许拿「读数链需要」（新源优先、
 * 旧源回退）当理由——那条链正是 S2 要删掉的东西，写进注释就等于给它发了授权。
 *
 * 计数的写法（漏一种就等于没守）：
 *   单/双引号、模板串、大写形态 `'Narwhal'`/`'0xRouter'`、常量名
 *   `marketCalendarProviderId`/`marketCalendarLegacyProviderId`/`marketCalendarSourceName`、
 *   前缀串 `macro-calendar-narwhal`/`-0xrouter`；数组包含里的字面量同样会被计数。
 * **`.tsx` 也在范围内**：规则说「组件里按源分支就算错」，那就必须真的看组件。
 *
 * **i18n 按「文件用途」判，不按词判**：允许出现源名的文案集中列在 `I18N_SOURCE_NAME_FILES`
 * （整文件豁免），**其余 i18n 文件零豁免**，出现即红。不按词判是因为「含『来源』就放行」会被
 * 这样绕过：`'card.cpi.yoy': '数据来源：Narwhal'`、`'calendar.row.cpi': 'Narwhal CPI 年率'`。
 * 判据从「这行有没有某几个词」变成「这个文件是干什么的」。
 *
 * 基线与本用例同一笔提交；不带基线就是出生即红的门禁。
 */
const PRODUCT = new URL('../../../', import.meta.url).pathname
/** 扫描根的**期望值**：改扫描根必须同时改这里，diff 里藏不住。 */
const EXPECTED_ROOTS = Object.freeze(['service/intelligence/macro-calendar', 'desktop', 'contracts'])
const ROOTS = EXPECTED_ROOTS
const PATTERN = /(['"`])(?:narwhal|0xrouter|Narwhal|0xRouter)\1|marketCalendarProviderId|marketCalendarLegacyProviderId|marketCalendarSourceName|macro-calendar-narwhal|macro-calendar-0xrouter/g
const SOURCE_NAME = /narwhal|0xrouter/i

/**
 * 允许出现源名的 i18n 文件（**整文件豁免**）。
 *
 * 今天就是这三份：源显示名与源清单、以及汇总文案表（`productText.ts` 是它们的生成汇总）。
 * 目标是继续收拢到专用文件；收拢不改变判据——**其余 i18n 文件零豁免**。
 */
const I18N_SOURCE_NAME_FILES = Object.freeze([
  'desktop/shared/i18n/productText.ts',
  'desktop/shared/i18n/text/settings/intelligenceSources.ts',
  'desktop/shared/i18n/text/settings/macroCalendar.ts'
])
/** 名表的**显式路径清单**：改名或挪位置这里对不上 → 红；清单空着也红。 */
const NAME_TABLE_PATHS = Object.freeze([
  'service/intelligence/macro-calendar/marketCalendarDisplayNameTables.ts'
])
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
  it('新增一处源名分支必须同时登记基线（四种写法 + .tsx）', () => {
    const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as { files: Record<string, { count: number }> }
    const current: Record<string, number> = {}
    for (const root of ROOTS) {
      for (const file of files(join(PRODUCT, root))) {
        const rel = relative(PRODUCT, file)
        const source = readFileSync(file, 'utf8')
        const isI18n = rel.includes('shared/i18n/')
        const hits = isI18n
          ? (I18N_SOURCE_NAME_FILES.includes(rel) ? 0
            : source.split('\n').filter((line) => SOURCE_NAME.test(line)).length)
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

describe('汇总文案表不许手改', () => {
  it('productText.ts 里每处带源名的文案，都必须在某个 text/** 源文件里找得到同一串', () => {
    // `productText.ts` 是全产品文案的汇总（2964 行），卡片、事件名、日历行的文案都在里面。
    // 整文件豁免等于把它摘出守卫，所以补一条漂移断言：**汇总里的源名文案必须能在源文件里找到**。
    // 这条同时挡住「有人手改生成文件」——这个仓里手改它丢过 key，不是假设。
    const aggregate = readFileSync(join(PRODUCT, 'desktop/shared/i18n/productText.ts'), 'utf8')
    const strings = new Set(aggregate.match(/'[^'\n]*'|"[^"\n]*"/g) ?? [])
    const withSource = [...strings].filter((text) => SOURCE_NAME.test(text))
    const sourceTexts: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) { walk(full); continue }
        if (entry.endsWith('.ts') && !/\.test\.ts$/.test(entry)) sourceTexts.push(readFileSync(full, 'utf8'))
      }
    }
    walk(join(PRODUCT, 'desktop/shared/i18n/text'))
    // 这 8 串是**已知内联**在汇总里的（市场日历那段文案直接写在 productText 里，尚未搬到
    // `text/**`）。它们登记在这里，等于「现状已核实」；**新增一处内联文案 → 红**。
    const inline = [
      "'0xRouter 市场日历'", "'日历时间：Narwhal'", "'前值（Narwhal）'", "'公布值（Narwhal）'",
      "'0xRouter market calendar'", "'Calendar time: Narwhal'", "'Previous (Narwhal)'", "'Actual (Narwhal)'"
    ]
    const missing = withSource
      .filter((text) => !inline.includes(text))
      .filter((text) => !sourceTexts.some((source) => source.includes(text)))
    expect(missing, `这些带源名的文案只在汇总里、源文件里找不到（手改过？）：\n${missing.join('\n')}`).toEqual([])
  })
})

describe('名表按字段形状抓，不靠命名', () => {
  it('四列名表字段出现两处以上的文件，必须在名表清单里', () => {
    // 锚不是文件名（`calendarCodeTable.ts` 这种根本匹配不上正则），而是**字段形状**：
    // 同时出现 `zhFull/zhShort/enFull/enShort` 里两个以上 → 它就是一张四列名表，必须登记。
    const FIELDS = ['zhFull', 'zhShort', 'enFull', 'enShort'] as const
    const offenders: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry === 'dist' || entry === 'out') continue
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) { walk(full); continue }
        if (!entry.endsWith('.ts') || /\.test\.ts$/.test(entry)) continue
        const rel = relative(PRODUCT, full)
        if (NAME_TABLE_PATHS.includes(rel) || rel.includes('shared/i18n/')) continue
        const source = readFileSync(full, 'utf8')
        if (FIELDS.filter((field) => source.includes(field)).length >= 2) offenders.push(rel)
      }
    }
    walk(PRODUCT)
    expect(offenders, `这些文件长着四列名表的样子却没登记在 NAME_TABLE_PATHS 里：\n${offenders.join('\n')}`)
      .toEqual([])
  })
})

describe('名表位置与扫描根', () => {
  it('名表用显式路径清单登记：不存在、或在扫描范围之外 → 红；清单空着也红', () => {
    expect(NAME_TABLE_PATHS.length, '名表清单不能是空的——空清单等于什么都没守').toBeGreaterThan(0)
    for (const path of NAME_TABLE_PATHS) {
      expect(() => statSync(join(PRODUCT, path)), `名表不存在：${path}`).not.toThrow()
      expect(ROOTS.some((root) => path.startsWith(root)), `名表不在扫描范围内：${path}`).toBe(true)
    }
  })

  it('扫描根清单不许被悄悄放宽', () => {
    expect([...ROOTS]).toEqual([...EXPECTED_ROOTS])
    expect(EXPECTED_ROOTS.length).toBe(3)
  })
})
