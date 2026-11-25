import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { MACRO_INDICATOR_GROUPS, MACRO_INDICATOR_RETIRED_METRIC_KEYS } from './macroIndicatorCardGroups'
import { metricCatalog, metricKeysForConceptOf } from './marketCalendarMetricCatalog'

/**
 * 指标映射单表的两条完整性守卫（架构师 2026-11-14 规格 `29-指标映射单表规格.md` §3）。
 *
 * 这两条不是在测「表长什么样」——表是派生的，按构造总是自洽的。它们测的是
 * **一个指标的身份有没有凑齐**：今晚那次换码漏掉盘口 slug，就是因为没有任何一处
 * 把「这个码该有哪些事实」列出来给你签字。
 */

const CATALOG_SOURCE = join(process.cwd(),
  'products/market-intelligence/service/intelligence/macro-calendar/marketCalendarMetricCatalog.ts')

describe('守卫 A：12 行卡片逐行断身份齐全', () => {
  it('每一行都给出 名字 / 分组 / 卡片位 / 源腿 / 官方发布（或带原因的例外）', () => {
    const catalog = metricCatalog()
    const missing: string[] = []
    for (const group of MACRO_INDICATOR_GROUPS) {
      for (const row of group.rows) {
        const entry = catalog.get(row.metricKey)
        if (entry === undefined) {
          missing.push(`${row.metricKey}: 不在 catalog 里`)
          continue
        }
        if (entry.name === undefined) missing.push(`${row.metricKey}: 缺 name`)
        if (entry.group === undefined) missing.push(`${row.metricKey}: 缺 group`)
        if (entry.card === undefined) missing.push(`${row.metricKey}: 缺 card`)
        if (entry.sources.length === 0) missing.push(`${row.metricKey}: 缺 sources（一条腿都没有）`)
        /* 官方这一项**三种并列**（Chief 2026-11-14）：
           ① 有发布映射（BEA/BLS 那条发布把值写成这个身份）；
           ② 有官方腿（例如只有 FRED 一条官方序列，没有对应的发布映射）；
           ③ 例外清单里写了 reason + resolution。
           **例外＝补不上的缺口，不是②的替代品**——四格月率有 FRED 腿，把它们记成缺口会让下一轮的人
           去「补」一个不需要补的东西。三者都没有 = 这个码「官方那边怎么来」没人说过，正是今晚漏的那一项。 */
        const exception = entry.officialLegException
        const exceptionExplained = exception !== undefined
          && exception.reason.trim().length > 0
          && exception.resolution.trim().length > 0
        const hasOfficial = entry.officialRelease !== undefined
          || exceptionExplained
          || entry.sources.some((source) => source.kind === 'official')
        if (!hasOfficial) missing.push(`${row.metricKey}: 缺 officialRelease，也没有带 reason+resolution 的例外`)
      }
    }
    // 一次报全：只报第一处会让人改一轮跑一轮。
    expect(missing.join('\n')).toBe('')
  })
})

describe('守卫 B：反向孤儿', () => {
  /**
   * 「有人用了一个码，却没人说它是什么」——这才是孤儿的真相（第一版按「没被任何表提到」判，
   * 实测抓不到东西：往盘口 slug 表手写一个新码，它自己就把自己登记了，守卫照样绿）。
   *
   * 判据：**某个操作表里用到它**（卡片行 / 源腿 / 官方发布 / 盘口模板 / 政策路径 / 源内身份），
   * 但它**既没有名字、也没有分组**——读者看到的是一个说不出名字的码。先红一次实测：
   * 往盘口表插 `US.MADE_UP.NONE.YOY` → 这条红；删掉后绿。
   */
  it('fails when a code is used by an operational table but nobody named it', () => {
    const orphans = [...metricCatalog().values()].flatMap((entry) => {
      const used = entry.card !== undefined
        || entry.sources.length > 0
        || entry.officialRelease !== undefined
        || entry.marketSlugTemplate !== undefined
        || entry.policyPath.annotated
        || entry.policyPath.sameWindowPriority
        || entry.sourceKeys.narwhalMeasures.length > 0
        || entry.sourceKeys.zeroXRouterIndicatorIds.length > 0
      const identified = entry.name !== undefined || entry.group !== undefined
      return used && !identified ? [entry.metricKey] : []
    })
    expect(orphans.join(', ')).toBe('')
  })

  it('catalog 里每个码都被至少一张源头表提到', () => {
    const orphans = [...metricCatalog().values()]
      .filter((entry) => entry.mentionedBy.length === 0)
      .map((entry) => entry.metricKey)
    expect(orphans.join(', ')).toBe('')
  })

  /**
   * 源码级：**catalog 自己不许写指标码**（它只合成）。
   *
   * 原本还有后半句「散落在别处的码必须在 catalog 里」——那条已撤：catalog 的键集就是这些表的并集，
   * 等于自己判自己，而且只扫 8 个文件。判据换成「在名称表里」、扫描面扩到全模块，
   * 见 `marketCalendarCodeNames.test.ts` 的「码本体：散落各处的码必须在名称表里」。
   */
  it('keeps the catalog free of metric literals', () => {
    const source = readFileSync(CATALOG_SOURCE, 'utf8')
    // 指标码的形状是 `US.<测度>.<口径>.<量纲>`：四段起。两段的 `US.CPI` 是发布前缀，不是码。
    const metricLiteral = /'US\.[A-Z0-9_]+(\.[A-Z0-9_]+){2,}'/g
    expect(source.match(metricLiteral) ?? []).toEqual([])
  })
})

describe('盘口那一半（M4 要读的事实）', () => {
  it('exposes both the slug template and the bucket divisor, so M4 never restates them', () => {
    const catalog = metricCatalog()
    const withSlug = [...catalog.values()].filter((entry) => entry.marketSlugTemplate !== undefined)
    expect(withSlug.length).toBeGreaterThan(0)
    for (const entry of withSlug) expect(entry.marketSlugTemplate, entry.metricKey).toMatch(/\{month\}/)
    /* 非农的档位是绝对人数、卡片口径是千：换算值必须能从 catalog 读到，否则 M4 会在消费处再写一遍 1000。 */
    const payrolls = withSlug.find((entry) => entry.marketValueDivisor !== undefined)
    expect(payrolls?.marketValueDivisor).toBe(1000)
  })
})

describe('退役表与变体入口', () => {
  it('每个退役码都指向一个真实存在的当前码，并写了原因', () => {
    const catalog = metricCatalog()
    for (const retired of MACRO_INDICATOR_RETIRED_METRIC_KEYS) {
      expect(catalog.has(retired.retiredMetricKey), retired.retiredMetricKey).toBe(true)
      expect(catalog.has(retired.currentMetricKey), retired.currentMetricKey).toBe(true)
      expect(retired.reason.trim().length, retired.retiredMetricKey).toBeGreaterThan(0)
    }
  })

  /**
   * 「同一概念取全部变体」：当前码在前、退役码在后。政策路径白名单与优先序里那三个
   * 「未季调兼容位」就靠它，而不是各自把旧码写死一遍。
   */
  it('returns every identity of a concept, current one first', () => {
    const catalog = metricCatalog()
    const retiredPairs = MACRO_INDICATOR_RETIRED_METRIC_KEYS
    for (const retired of retiredPairs) {
      const variants = metricKeysForConceptOf(retired.currentMetricKey)
      expect(variants, retired.currentMetricKey).toContain(retired.currentMetricKey)
      expect(variants, retired.currentMetricKey).toContain(retired.retiredMetricKey)
      expect(variants[0], retired.currentMetricKey).toBe(retired.currentMetricKey)
      for (const key of variants) expect(catalog.has(key), key).toBe(true)
    }
  })
})
