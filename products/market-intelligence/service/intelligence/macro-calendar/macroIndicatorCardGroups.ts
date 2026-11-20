import { MACRO_INDICATOR_CARD_KEYS, type MacroIndicatorCardKey } from './macroIndicatorCardFacts'

/** 一行的量纲：决定正负号与单位（年率、失业率不带正号；月率、时薪、非农带正负号）。 */
export type MacroIndicatorRowKind = 'yoy' | 'mom' | 'rate' | 'change'

/**
 * 一级核心指标的**分组**：3 个大类 × 每组 4 行。这是分组唯一的出处——
 * 卡片的行序、设置页的分组与左侧「3 类 / 12 项指标」的计数都从它派生，不许各写一份。
 *
 * 表里只放数据（组 id、标题键、行名键、`metric_key`、顺序）；文案由渲染层按 `titleKey` /
 * `labelKey` 去文案表取，所以这张表不依赖渲染层、也不含任何句子。
 */
export type MacroIndicatorGroupRow = Readonly<{
  metricKey: MacroIndicatorCardKey
  /** 行名键，指向 `cardRows.*`（三张卡共用同一套行名）。 */
  labelKey: 'yoy' | 'mom' | 'coreYoy' | 'coreMom' | 'nonfarm' | 'unemployment' | 'avgHourlyMom' | 'avgHourlyYoy'
  kind: MacroIndicatorRowKind
}>

export type MacroIndicatorGroup = Readonly<{
  id: string
  /** 组标题键，指向 `cards.*.title`。 */
  titleKey: 'cpi' | 'payrolls' | 'pce'
  rows: readonly MacroIndicatorGroupRow[]
}>

export const MACRO_INDICATOR_GROUPS = Object.freeze([
  {
    id: 'cpi',
    titleKey: 'cpi',
    rows: [
      { metricKey: 'US.CPI.NSA.YOY', labelKey: 'yoy', kind: 'yoy' },
      { metricKey: 'US.CPI.SA.MOM', labelKey: 'mom', kind: 'mom' },
      { metricKey: 'US.CORE_CPI.NSA.YOY', labelKey: 'coreYoy', kind: 'yoy' },
      { metricKey: 'US.CORE_CPI.SA.MOM', labelKey: 'coreMom', kind: 'mom' }
    ]
  },
  {
    id: 'payrolls',
    titleKey: 'payrolls',
    rows: [
      { metricKey: 'US.NONFARM.SA.CHANGE', labelKey: 'nonfarm', kind: 'change' },
      { metricKey: 'US.UNEMPLOYMENT.SA.RATE', labelKey: 'unemployment', kind: 'rate' },
      { metricKey: 'US.AHE.SA.MOM', labelKey: 'avgHourlyMom', kind: 'mom' },
      { metricKey: 'US.AHE.NSA.YOY', labelKey: 'avgHourlyYoy', kind: 'yoy' }
    ]
  },
  {
    id: 'pce',
    titleKey: 'pce',
    rows: [
      { metricKey: 'US.PCE.SA.YOY', labelKey: 'yoy', kind: 'yoy' },
      { metricKey: 'US.PCE.SA.MOM', labelKey: 'mom', kind: 'mom' },
      { metricKey: 'US.CORE_PCE.SA.YOY', labelKey: 'coreYoy', kind: 'yoy' },
      { metricKey: 'US.CORE_PCE.SA.MOM', labelKey: 'coreMom', kind: 'mom' }
    ]
  }
] as const)

/** 分组摊平后的全部码；设置页的「12 项指标」与卡片的行数都从它取，避免两处计数。 */
export const MACRO_INDICATOR_GROUP_METRIC_KEYS: readonly MacroIndicatorCardKey[] =
  MACRO_INDICATOR_GROUPS.flatMap((group) => group.rows.map((row) => row.metricKey))

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
