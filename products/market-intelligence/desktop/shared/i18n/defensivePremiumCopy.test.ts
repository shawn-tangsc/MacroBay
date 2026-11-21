import { describe, expect, it } from 'vitest'

import { sentimentOptionsCardPolicy } from '../../../service/intelligence/public-query/sentimentOptionsCardPolicy'
import { productText } from './productText'

/**
 * 恐惧与防跌溢价卡的中英文案守卫（配置线，2026-11-21）。
 *
 * 判的是四件事，每条都能反过来跑红：
 * 1. **键集齐全且两语一致**——少一个键，实现方就会在那处写死中文；中英形状不一致，另一语言下就是空行或裸键名。
 * 2. **卡名冻结**——用户 2026-11-21 定名，改动即红（这是本卡唯一被钉死的原文）。
 * 3. **禁词**：任何值里不许出现 `交易日 / trading day / session`（读者会读成股票日历）、`代理 / proxy`
 *    （那是设置页的话，卡只说读不到与类别）、相对时间（`这次 / 今天 / 昨天 / 明天 / 稍后`——同一句要同时
 *    覆盖「这回读不到」和「从来没接上」），以及枚举值 `steeper / flatter / flat` 不许散在句子里——只许进方向位那三个键（第 4 条）。
 * 4. **方向词只许出现在两个槽**：方向位（`skew.direction.steeper/flatter/flat`，数据正常时那半自己印一行）
 *    与结论槽（`verdict.*`）可以说走阔/收窄/基本没动；「方向未知」三句、卡头 ⓘ、缺半句、整卡降级句里出现即红。
 *    方向位是 2026-11-22 才合法化的槽（PRD AC-01/AC-19 要「方向位」），此前只许结论句有方向词。
 *
 * 不钉整句原文（文案会润色），只钉上面这些语义约束——润色改词不该让验收变红。
 */

const BAND_PREFIX = ['pages', 'intelligence', 'portal', 'dashboard', 'defensivePremium'] as const

/**
 * 方向位：数据正常时右半自己印的那三个词。它们是唯一允许出现方向词的 `skew.direction.*` 键；
 * 同一层的 `window / insufficient / stale / discontinuous` 是「方向未知」的话，仍不许带方向词。
 */
const DIRECTION_SLOT_PATHS = ['skew.direction.steeper', 'skew.direction.flatter', 'skew.direction.flat'] as const

/** 界面上会看见的每一个键，缺一个就在这里红。 */
const REQUIRED_PATHS = [
  'title',
  'titleInfo',
  'titleInfoLabel',
  'window',
  'observedAt',
  'provenance',
  'fearGreed.name',
  'fearGreed.axis',
  'fearGreed.asOf',
  'fearGreed.infoLabel',
  'fearGreed.info.volatility',
  'fearGreed.info.percentile',
  'fearGreed.info.percentileInsufficient',
  'fearGreed.info.sourceDay',
  'skew.name',
  'skew.asOf',
  'skew.unit',
  'skew.notConnected',
  'skew.infoLabel',
  'skew.info.definition',
  'skew.info.relative',
  'skew.info.since',
  'skew.info.sourceDay',
  'skew.direction.window',
  'skew.direction.steeper',
  'skew.direction.flatter',
  'skew.direction.flat',
  'skew.direction.insufficient',
  'skew.direction.stale',
  'skew.direction.discontinuous',
  'history.since',
  'history.remaining',
  'chart.fearGreedAria',
  'chart.skewAria',
  'chart.fearGreedSummary',
  'chart.skewSummary',
  'stale.pill',
  'action.refresh',
  'action.enable',
  'action.viewSource',
  'verdict.asOfSuffix',
  'verdict.fear.steeper',
  'verdict.fear.flatter',
  'verdict.fear.flat',
  'verdict.fear.skewMissing',
  'verdict.greed.steeper',
  'verdict.greed.flatter',
  'verdict.greed.flat',
  'verdict.greed.skewMissing',
  'verdict.neutral.steeper',
  'verdict.neutral.flatter',
  'verdict.neutral.flat',
  'verdict.neutral.skewMissing',
  'verdict.fgMissing.steeper',
  'verdict.fgMissing.flatter',
  'verdict.fgMissing.flat',
  'degraded.fearGreed',
  'degraded.skew'
] as const

type Banned = Readonly<{ pattern: RegExp; why: string; except?: readonly string[] }>

/**
 * 禁词表。`except` 是「这个词在这一处合法」的白名单——目前只有一格：方向位要印方向词本身，
 * 其余任何键（含方向未知三句、结论句、卡头 ⓘ）出现方向词或枚举值仍然算红。
 */
const BANNED: readonly Banned[] = [
  { pattern: /交易日/u, why: '交易日会让读者以为是股票日历' },
  { pattern: /trading\s*day/iu, why: '同「交易日」' },
  { pattern: /session/iu, why: '同「交易日」' },
  { pattern: /代理/u, why: '代理是设置页的话，卡上不许出现' },
  { pattern: /\bproxy\b/iu, why: '同「代理」' },
  { pattern: /这次/u, why: '同一句要覆盖「这回读不到」和「从来没接上」' },
  { pattern: /今天/u, why: '不让读者以为是相对时间' },
  { pattern: /昨天/u, why: '不让读者以为是相对时间' },
  { pattern: /明天/u, why: '不让读者以为是相对时间' },
  { pattern: /稍后/u, why: '不让读者以为是相对时间' },
  { pattern: /\bthis time\b/iu, why: '同上，英文侧' },
  { pattern: /\b(?:steeper|flatter|flat)\b/iu, why: '枚举值不许散在句子里，只许进方向位', except: DIRECTION_SLOT_PATHS }
]

/** 卡上说「往哪边动」的词：中文两侧（方向位、结论句）同一套，英文一侧见下。 */
const DIRECTION_WORDS = [
  /走阔/u,
  /收窄/u,
  /基本没动/u,
  /\bwidening\b/iu,
  /\bnarrowing\b/iu,
  /\bbarely moved\b/iu
] as const

type Leaf = Readonly<{ path: string; value: string }>

function block(locale: 'zh-CN' | 'en-US'): Record<string, unknown> {
  let node: unknown = productText[locale]
  for (const key of BAND_PREFIX) node = (node as Record<string, unknown> | undefined)?.[key]
  expect(node, `${locale}: ${BAND_PREFIX.join('.')} missing`).toBeTypeOf('object')
  return node as Record<string, unknown>
}

function leaves(node: unknown, prefix: string, out: Leaf[]): Leaf[] {
  if (typeof node === 'string') {
    out.push({ path: prefix, value: node })
    return out
  }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    leaves(value, prefix === '' ? key : `${prefix}.${key}`, out)
  }
  return out
}

const zh = leaves(block('zh-CN'), '', [])
const en = leaves(block('en-US'), '', [])
const pathOf = (leaf: Leaf): string => leaf.path

describe('fear & greed + downside premium card copy', () => {
  it('carries every key the card renders, on both locales', () => {
    const zhPaths = new Set(zh.map(pathOf))
    const enPaths = new Set(en.map(pathOf))
    const missing = [
      ...REQUIRED_PATHS.filter((path) => !zhPaths.has(path)).map((path) => `zh:${path}`),
      ...REQUIRED_PATHS.filter((path) => !enPaths.has(path)).map((path) => `en:${path}`)
    ]
    expect(missing).toEqual([])
  })

  it('keeps the two locales structurally identical and non-empty', () => {
    expect([...en.map(pathOf)].sort()).toEqual([...zh.map(pathOf)].sort())
    const blank = [...zh, ...en].filter((leaf) => leaf.value.trim() === '').map(pathOf)
    expect(blank).toEqual([])
  })

  it('pins the frozen card name', () => {
    expect(block('zh-CN').title).toBe('恐惧与防跌溢价')
    expect(block('en-US').title).toBe('Fear & Greed and Downside Premium')
  })

  it('keeps every value free of banned words', () => {
    const findings: string[] = []
    for (const leaf of [...zh, ...en]) {
      for (const banned of BANNED) {
        if (banned.except?.includes(leaf.path)) continue
        if (banned.pattern.test(leaf.value)) findings.push(`${leaf.path}: ${banned.why}`)
      }
    }
    expect(findings).toEqual([])
  })

  it('ties every direction-window number to direction.points instead of a stray constant', () => {
    // 文案静态写「近 5 天」（占位会诱导实现方填自然日），但那个 5 必须跟着判据走：
    // 常量改了、文案没改，这条用例就红——不靠人记得。
    const points = sentimentOptionsCardPolicy.direction.points
    const zhLeaves = leaves(block('zh-CN'), '', [])
    const enLeaves = leaves(block('en-US'), '', [])
    const pick = (list: Leaf[], path: string): string => list.find((leaf) => leaf.path === path)?.value ?? ''
    expect(pick(zhLeaves, 'skew.direction.window')).toContain(`近 ${points} 天`)
    expect(pick(enLeaves, 'skew.direction.window')).toContain(`Last ${points} days`)
    expect(pick(zhLeaves, 'skew.direction.insufficient')).toContain(`还不够 ${points} 天`)
    expect(pick(enLeaves, 'skew.direction.insufficient')).toContain(`Fewer than ${points} days`)
  })

  it('keeps direction words out of the direction-unknown sentences, the card-head popover and the degraded lines', () => {
    // 方向位（DIRECTION_SLOT_PATHS）是 2026-11-22 起唯一允许出现方向词的 skew.direction.* 键；
    // 同一层其余四条是「方向未知」的话，说了方向就等于硬凑结论。
    // verdict.* 与缺半句（.fgMissing）本来就是结论槽、允许方向词，不在守卫名单里。
    const guarded = [...zh, ...en].filter(
      (leaf) =>
        (leaf.path.startsWith('skew.direction.') &&
          !(DIRECTION_SLOT_PATHS as readonly string[]).includes(leaf.path)) ||
        leaf.path === 'titleInfo' ||
        leaf.path.endsWith('.skewMissing') ||
        leaf.path.startsWith('degraded.')
    )
    expect(guarded.length).toBeGreaterThan(0)
    const findings: string[] = []
    for (const leaf of guarded) {
      for (const word of DIRECTION_WORDS) {
        if (word.test(leaf.value)) findings.push(`${leaf.path}: ${String(word)}`)
      }
    }
    expect(findings).toEqual([])
  })
})