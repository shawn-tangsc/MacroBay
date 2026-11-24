import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { MACRO_INDICATOR_CARD_KEYS } from '../service/intelligence/macro-calendar/macroIndicatorCardGroups'

/**
 * 守卫 D｜换码演练的**静态那一半**（架构师规格 §3、Chief 2026-11-14 定的两段判据）。
 *
 * 判的不再是「三条路径都取到值」（那是 M2/M3/M5 各自的判据，重跑一遍没有信息量），而是：
 *
 * - **消费者 0**：盘口、政策路径、回填、卡片渲染、读数服务——改名后**一个字都不用动**。
 *   这一条查它们有没有把这 12 个码写死；写死一处，改名时就必须去改，判据就不成立了。
 * - **名称映射 0 处**：设置页那份 12 条 `metricKey → 文案键` 的清单已经去掉——显示名跟着分组行
 *   （`metricNameKey`）走，码本身从分组表派生。所以设置页现在也是「消费者」，不再按码写。
 *   「12 个码有名字」这件事由 `CoreIndicatorsSourcesView.test.tsx` 另有一条守卫钉住（中英两套）。
 *
 * 为什么不真改生产文件去「改名」：那需要在生产代码里开缝（每处加可选参数），缝本身就成了新隐患。
 * 静态查「消费者有没有硬编码」是同一件事的可验证形式；概念归属本身另有双向守卫
 * （`contracts/metricKeyConcept.test.ts`）与「两个变体同一个盘口」的行为用例。
 *
 * 一条要记住的事实（写进基线，也写在这里）：**一个码今天住在 8–13 张数据表里**（名称、分组、源侧字典、
 * 官方发布、FRED 序列、卡片行、退役表…）。真改名时那些表各改一行——那是「关于这个码的事实」，
 * 不是抄件；**消费者才是必须为零的那一类**。
 */
const PRODUCT_ROOT = join(process.cwd(), 'products/market-intelligence')

/**
 * 消费者清单（不含数据表）：这些文件按码**读**，不许按码**写**。
 * 加新消费者时把它加进来——这是这张表唯一的维护动作。
 */
const CONSUMER_FILES = [
  'service/intelligence/macro-calendar/polymarketConsensus.ts',
  'contracts/policyPath.ts',
  'service/intelligence/macro-calendar/marketCalendarStandardBackfill.ts',
  'service/intelligence/macro-calendar/macroIndicatorReadService.ts',
  'desktop/pages/intelligence/MacroIndicatorDrawer.tsx',
  'desktop/pages/intelligence/IndicatorCards.tsx',
  'desktop/pages/intelligence/useCalendarCardData.ts'
] as const

describe('守卫 D：换码后消费者一处都不用改', () => {
  it('没有消费者把卡片 12 个码写死', () => {
    const offenders: string[] = []
    for (const relative of CONSUMER_FILES) {
      const source = readFileSync(join(PRODUCT_ROOT, relative), 'utf8')
      for (const key of MACRO_INDICATOR_CARD_KEYS) {
        if (source.includes(`'${key}'`)) offenders.push(`${relative}: ${key}`)
      }
    }
    expect(offenders.join('\n'),
      '消费者写死了指标码：改名时这些地方都要改，换码演练的判据就不成立了').toBe('')
  })

  /**
   * 反向：这 12 个码只允许出现在「数据表」里。出现别处 = 又一个按码建的表，改名时会被漏掉
   * （今晚那次就是这样漏的）。**设置页与卡片读数都不在名单里**：它们只读派生的码表。
   */
  it('keeps the twelve codes inside the data tables, not in consumers', () => {
    const allowed = new Set<string>([
      'contracts/metricKeyConcept.ts',
      'service/intelligence/macro-calendar/macroIndicatorCardGroups.ts',
      'service/intelligence/macro-calendar/marketCalendarCodeNames.ts',
      'service/intelligence/macro-calendar/marketCalendarDisplayNameTables.ts',
      'service/intelligence/macro-calendar/marketCalendarMetricIdentity.ts',
      // 同一张表搬了家、不是新开一张：Narwhal 的 measure → 码 那 132 条 2026-11-21 从
      // `marketCalendarMetricIdentity.ts` 抽成纯数据模块（文件体积门禁），全仓只有这一份。
      'service/intelligence/macro-calendar/marketCalendarNarwhalMeasureKeys.ts',
      'service/intelligence/macro-calendar/marketCalendarReleaseGroups.ts',
      'service/intelligence/macro-calendar/macroCalendarReleaseValueMappingPolicy.ts',
      'service/intelligence/macro-calendar/fredIndicatorYoY.ts',
      'service/intelligence/macro-calendar/coreIndicatorValueSources.ts',
      'service/intelligence/macro-calendar/marketCalendarStandardBackfill.ts',
      'service/intelligence/macro-calendar/narwhal-calendar/narwhalSeriesPrimaryMetric.ts'
    ])
    const offenders: string[] = []
    for (const key of MACRO_INDICATOR_CARD_KEYS) {
      for (const [relative, source] of productionSources()) {
        if (!source.includes(`'${key}'`)) continue
        if (!allowed.has(relative)) offenders.push(`${relative}: ${key}`)
      }
    }
    expect([...new Set(offenders)].join('\n'),
      '这些文件既不是数据表，也不是那唯一一处名称映射——又一处按码建的表').toBe('')
  })
})

function productionSources(): Map<string, string> {
  const files = new Map<string, string>()
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') visit(full)
        continue
      }
      if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) continue
      if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.tsx')) continue
      files.set(full.slice(PRODUCT_ROOT.length + 1), readFileSync(full, 'utf8'))
    }
  }
  visit(PRODUCT_ROOT)
  return files
}
