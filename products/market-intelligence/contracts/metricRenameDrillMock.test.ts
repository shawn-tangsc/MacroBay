import { describe, expect, it, vi } from 'vitest'

/**
 * guard D 的 **mock 那一半**：把「码 → 概念」整表换成改名版，看谁会坏。
 *
 * 判据（Chief 2026-11-14）：**数据表坏是应该的**（盘口 slug、政策路径清单是「概念 → 模板」的事实表），
 * **消费者坏才是缺陷**（消费者按概念串拼码，改名就得跟着改）。
 *
 * 三个技术点缺一不可，我上次就是栽在这上面（写出来永远绿）：
 * 1. `vi.mock` 写在文件顶部（会被提升），且 specifier 必须解析到**被测代码用的同一个文件**；
 * 2. 工厂里 `importActual` 复用原模块再改写；
 * 3. 被测模块要**在 mock 之后**动态 import，否则拿到真模块。
 */
vi.mock('./metricKeyConcept', async () => {
  const actual = await vi.importActual<typeof import('./metricKeyConcept')>('./metricKeyConcept')
  /* **表和函数都要换**：盘口那张表读的是 `metricConceptByMetricKey[...]`，只改函数不算概念改名
     （我上一版就栽在这里——slug 照样查得到，于是「没有断点」，演练白跑）。 */
  const renamedTable = Object.fromEntries(Object.entries(actual.metricConceptByMetricKey)
    .map(([metricKey, concept]) => [metricKey, `${concept}#R`]))
  return {
    ...actual,
    metricConceptByMetricKey: renamedTable,
    metricConceptOf: (metricKey: string) => renamedTable[metricKey] ?? metricKey
  }
})

describe('守卫 D（mock 半）：概念改名后，坏只该坏在概念键的数据表上', () => {
  it('actually replaces the concept module — otherwise everything below is meaningless', async () => {
    const { metricConceptOf } = await import('./metricKeyConcept')
    // 这一条必须先绿：它证明 mock 生效了。不先验这一步，下面的断言全是白跑（上次就是这么栽的）。
    expect(metricConceptOf('US.CPI.NSA.YOY')).toBe('US.CPI.YOY#R')
  })

  it('lets the read path survive a concept rename — the catalog derives concepts, it does not hardcode them', async () => {
    const { metricCatalogForCards, metricKeysForConceptOf } = await import(
      '../service/intelligence/macro-calendar/marketCalendarMetricCatalog')
    const rows = metricCatalogForCards()
    // 12 行仍然取得到名称与来源：读路径不依赖概念串本身。
    expect(rows).toHaveLength(12)
    for (const row of rows) {
      expect(row.name, row.metricKey).toBeDefined()
      expect(row.sources.length, row.metricKey).toBeGreaterThan(0)
    }
    // 按概念取变体仍然成立：同一个概念的两个变体在改名世界里依旧同组。
    const variants = metricKeysForConceptOf('US.CORE_PCE.SA.YOY')
    expect(variants).toContain('US.CORE_PCE.SA.YOY')
    expect(variants).toContain('US.CORE_PCE.NSA.YOY')
  })

  it('breaks only in the concept-keyed data tables, and names the file and the code', async () => {
    const { polymarketSlugFor, polymarketConsensusPolicy } = await import(
      '../service/intelligence/macro-calendar/polymarketConsensus')
    const { metricConceptOf } = await import('./metricKeyConcept')
    const { metricCatalogForCards } = await import(
      '../service/intelligence/macro-calendar/marketCalendarMetricCatalog')

    const breakages: string[] = []
    for (const row of metricCatalogForCards()) {
      /* 改名世界里这个码的概念是 `X#R`；把后缀去掉就是「概念本来的名字」。
         若原概念在盘口表里有模板、而改名后 `polymarketSlugFor` 拿不到 → 这条断点属于**盘口那张数据表**。 */
      const concept = metricConceptOf(row.metricKey)
      const originalConcept = concept.endsWith('#R') ? concept.slice(0, -'#R'.length) : concept
      const templateExists = (polymarketConsensusPolicy.slugTemplateByConcept as Readonly<Record<string, string>>)[originalConcept] !== undefined
      if (!templateExists) continue
      if (polymarketSlugFor(row.metricKey, '2026-11') === undefined) {
        breakages.push(`service/intelligence/macro-calendar/polymarketConsensus.ts: ${row.metricKey}（数据表）`)
      }
    }
    /* 概念真改名时它**必须非空**：盘口表是按概念建的，改名必然查不到一条。
       若为空，说明盘口表其实按码建（或 mock 没生效），那这条演练就是白跑。 */
    expect(breakages.length).toBeGreaterThan(0)
    /* 而且每一条都要点得出「文件 + 码 + 属于数据表」——不许只报「有 N 个文件红」。 */
    for (const line of breakages) {
      expect(line).toMatch(/^(service|contracts|desktop)\/.+: US\.[A-Z0-9_.]+（数据表）$/)
    }
  })
})
