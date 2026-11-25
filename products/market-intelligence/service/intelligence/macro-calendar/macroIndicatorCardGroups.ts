/**
 * 一级核心指标的**分组**：3 个大类 × 每组 4 行。这是三样东西唯一的出处——
 * 12 个码（顺序即卡内行序）、设置页的分组与「3 类 / 12 项指标」的计数、
 * 9 行每行在设置页的显示名键（`metricNameKey`）。卡片、设置页、读数契约都从它派生，不许各写一份。
 *
 * 表里只放数据（组 id、标题键、行名键、显示名键、`metric_key`、顺序）；文案由渲染层按 `titleKey` /
 * `labelKey` / `metricNameKey` 去文案表取，所以这张表不依赖渲染层、也不含任何句子。
 *
 * `as const` 之后类型从表里反推：`MacroIndicatorCardKey` 就是各行 `metricKey` 的并集——
 * 所以「12 个码」在这里只有这一份，删掉一行，码表、计数、卡片行数一起少一项。
 */
export const MACRO_INDICATOR_GROUPS = Object.freeze([
  {
    id: 'cpi',
    titleKey: 'cpi',
    rows: [
      // 卡上行名与设置页显示名是两个词序：卡上「核心年率」、设置页「核心 CPI 年率」
      // （产品口径，不按「组名 + 行名」拼）。
      { metricKey: 'US.CPI.NSA.YOY', labelKey: 'yoy', kind: 'yoy', metricNameKey: 'cpiYoy' },
      { metricKey: 'US.CPI.SA.MOM', labelKey: 'mom', kind: 'mom', metricNameKey: 'cpiMom' },
      { metricKey: 'US.CORE_CPI.NSA.YOY', labelKey: 'coreYoy', kind: 'yoy', metricNameKey: 'coreCpiYoy' },
      { metricKey: 'US.CORE_CPI.SA.MOM', labelKey: 'coreMom', kind: 'mom', metricNameKey: 'coreCpiMom' }
    ]
  },
  {
    id: 'payrolls',
    titleKey: 'payrolls',
    rows: [
      { metricKey: 'US.NONFARM.SA.CHANGE', labelKey: 'nonfarm', kind: 'change', metricNameKey: 'nonfarm' },
      { metricKey: 'US.UNEMPLOYMENT.SA.RATE', labelKey: 'unemployment', kind: 'rate', metricNameKey: 'unemployment' },
      { metricKey: 'US.AHE.SA.MOM', labelKey: 'avgHourlyMom', kind: 'mom', metricNameKey: 'avgHourlyMom' },
      { metricKey: 'US.AHE.NSA.YOY', labelKey: 'avgHourlyYoy', kind: 'yoy', metricNameKey: 'avgHourlyYoy' }
    ]
  },
  {
    id: 'pce',
    titleKey: 'pce',
    rows: [
      { metricKey: 'US.PCE.SA.YOY', labelKey: 'yoy', kind: 'yoy', metricNameKey: 'pceYoy' },
      { metricKey: 'US.PCE.SA.MOM', labelKey: 'mom', kind: 'mom', metricNameKey: 'pceMom' },
      { metricKey: 'US.CORE_PCE.SA.YOY', labelKey: 'coreYoy', kind: 'yoy', metricNameKey: 'corePceYoy' },
      { metricKey: 'US.CORE_PCE.SA.MOM', labelKey: 'coreMom', kind: 'mom', metricNameKey: 'corePceMom' }
    ]
  }
] as const)

/** 一行的量纲：决定正负号与单位（年率、失业率不带正号；月率、时薪、非农带正负号）。 */
export type MacroIndicatorRowKind = 'yoy' | 'mom' | 'rate' | 'change'

export type MacroIndicatorGroupRow = typeof MACRO_INDICATOR_GROUPS[number]['rows'][number]

export type MacroIndicatorGroup = typeof MACRO_INDICATOR_GROUPS[number]

/** 12 个核心指标码——**唯一的一份**，其余各处（卡片行、设置页计数、读数契约）都读它。 */
export type MacroIndicatorCardKey = MacroIndicatorGroupRow['metricKey']

/** 分组摊平后的全部码，顺序即卡内行序。 */
export const MACRO_INDICATOR_CARD_KEYS: readonly MacroIndicatorCardKey[] =
  MACRO_INDICATOR_GROUPS.flatMap((group) => group.rows.map((row): MacroIndicatorCardKey => row.metricKey))

/**
 * **退役码 → 当前码**（数据，不是派生）：同一个概念换过一次口径，旧码的库中行还要能认。
 *
 * 为什么是数据表而不是派生：catalog 里不许出现指标码字面量，这两对字面量只能住在数据层，
 * 由 catalog 转出。放在这里是因为它就是「同一概念的两个身份」这件事，与 12 个码同一层。
 *
 * 用完不许手抄：回填里那份 `currentMetricKeyByRetiredKey` 会改成读它（M5）。
 * 加一个退役码 = 这里加一行，不是去每个消费方找一遍。
 */
export const MACRO_INDICATOR_RETIRED_METRIC_KEYS: readonly Readonly<{
  retiredMetricKey: string
  currentMetricKey: string
  reason: string
}>[] = Object.freeze([
  Object.freeze({
    retiredMetricKey: 'US.PCE.NSA.YOY',
    currentMetricKey: 'US.PCE.SA.YOY',
    reason: 'PCE 价格指数的公布口径是季调；旧码留着是因为库里还有它的历史行'
  }),
  Object.freeze({
    retiredMetricKey: 'US.CORE_PCE.NSA.YOY',
    currentMetricKey: 'US.CORE_PCE.SA.YOY',
    reason: '同上：核心 PCE 年率现在读季调码，未季调那一格等真·未季调来源'
  })
])