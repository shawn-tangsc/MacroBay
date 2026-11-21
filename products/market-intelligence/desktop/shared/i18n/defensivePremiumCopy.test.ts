import { describe, expect, it } from 'vitest'

import { sentimentOptionsCardPolicy } from '../../../service/intelligence/public-query/sentimentOptionsCardPolicy'
import { productText } from './productText'

/**
 * 恐惧与防跌溢价卡的中英文案守卫（配置线，2026-11-21）。
 *
 * 判的是五件事，每条都能反过来跑红：
 * 1. **键集齐全且两语一致**——少一个键，实现方就会在那处写死中文；中英形状不一致，另一语言下就是空行或裸键名。
 * 2. **卡名冻结**——用户 2026-11-21 定名，改动即红（这是本卡唯一被钉死的原文）。
 * 3. **禁词**：任何值里不许出现 `交易日 / trading day / session`（读者会读成股票日历）、`代理 / proxy`
 *    （那是设置页的话，卡只说读不到与类别）、相对时间（`这次 / 今天 / 昨天 / 明天 / 稍后`——同一句要同时
 *    覆盖「这回读不到」和「从来没接上」），以及枚举值 `steeper / flatter / flat`（卡上只说 Widening / Narrowing / Little changed 这一套）。
 * 4. **方向词只许出现在两个槽**：方向位（`skew.direction.steeper/flatter/flat`，数据正常时那半自己印一行）
 *    与结论槽（`verdict.*`）可以说走阔/收窄/基本没动；「方向未知」三句、卡头 ⓘ、缺半句、整卡降级句里出现即红。
 *    方向位是 2026-11-22 才合法化的槽（PRD AC-01/AC-19 要「方向位」），此前只许结论句有方向词。
 * 5. **一套词**：方向位的词必须原样出现在同方向的结论句里（中英各判一遍），方向位说 Steeper、结论句说 widening 这种各说一套即红。
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
  'fearGreed.name',
  'fearGreed.axis',
  'fearGreed.asOf',
  'fearGreed.infoLabel',
  'fearGreed.info.volatility',
  'fearGreed.info.percentile',
  'fearGreed.info.percentileInsufficient',
  'skew.name',
  'skew.asOf',
  'skew.unit',
  'skew.axis',
  'skew.notConnected',
  'skew.unavailable.connection',
  'skew.unavailable.source',
  'skew.unavailable.read',
  'skew.infoLabel',
  'skew.info.definition',
  'skew.info.relative',
  'skew.info.since',
  'skew.direction.window',
  'skew.direction.steeper',
  'skew.direction.flatter',
  'skew.direction.flat',
  'skew.direction.insufficient',
  'skew.direction.stale',
  'skew.direction.discontinuous',
  'history.remaining',
  'chart.fearGreedAria',
  'chart.skewAria',
  'chart.fearGreedSummary',
  'chart.skewSummary',
  'stale.pill',
  'stale.stopsAt',
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

/** 偏斜读不到那三句：按原因分句，不许抄成同一句。 */
const UNAVAILABLE_PATHS = ['skew.unavailable.connection', 'skew.unavailable.source', 'skew.unavailable.read'] as const

const BANNED: readonly { pattern: RegExp; why: string }[] = [
  { pattern: /交易日/u, why: '交易日会让读者以为是股票日历' },
  { pattern: /trading\s*day/iu, why: '同「交易日」' },
  { pattern: /session/iu, why: '同「交易日」' },
  { pattern: /代理/u, why: '代理是设置页的话，卡上不许出现' },
  { pattern: /\bproxy\b/iu, why: '同「代理」' },
  { pattern: /这次/u, why: '相对时间 2026-11-21 已定死删掉；同一句要覆盖「这回读不到」和「从来没接上」' },
  { pattern: /今天/u, why: '不让读者以为是相对时间' },
  { pattern: /昨天/u, why: '不让读者以为是相对时间' },
  { pattern: /明天/u, why: '不让读者以为是相对时间' },
  { pattern: /稍后/u, why: '不让读者以为是相对时间' },
  { pattern: /\bthis time\b/iu, why: '同上，英文侧' },
  { pattern: /\b(?:steeper|flatter|flat)\b/iu, why: '枚举值不许印到卡上；英文方向词只有 Widening / Narrowing / Little changed 这一套' }
]

/** 卡上说「往哪边动」的词：中文两侧（方向位、结论句）同一套，英文一侧见下。 */
const DIRECTION_WORDS = [
  /走阔/u,
  /收窄/u,
  /基本没动/u,
  /\bwidening\b/iu,
  /\bnarrowing\b/iu,
  /\blittle changed\b/iu
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

  const valueOf = (locale: 'zh-CN' | 'en-US', path: string): string =>
    leaves(block(locale), '', []).find((leaf) => leaf.path === path)?.value ?? ''

  it('names the skew half with its instrument and venue', () => {
    // AC-32：行名要带 BTC 与 Deribit——只说「期权偏斜」，读者不知道这半条是哪个标的、哪家交易所。
    for (const locale of ['zh-CN', 'en-US'] as const) {
      const name = valueOf(locale, 'skew.name')
      expect(name, `${locale}: skew.name needs the instrument`).toContain('BTC')
      expect(name, `${locale}: skew.name needs the venue`).toContain('Deribit')
    }
  })

  it('states the source-day basis once, in the card-head popover', () => {
    // AC-44：三处 ⓘ 不许说同一件事——日期口径只在卡头有一份，两个半条不再各说一遍。
    expect(valueOf('zh-CN', 'titleInfo')).toContain('数据源日（UTC）')
    expect(valueOf('en-US', 'titleInfo')).toMatch(/data source's day \(UTC\)/u)
  })

  it('keeps both providers named in the card head, now that the on-card source row is gone', () => {
    // 卡面来源行按定稿删掉（2026-11-22），供应商名字只留在卡头 ⓘ：两家都必须点名，
    // 且不许换成「全球指数 / BTC 单所」这类不点名的说法——那是读者查不到出处的写法。
    for (const locale of ['zh-CN', 'en-US'] as const) {
      const head = valueOf(locale, 'titleInfo')
      expect(head, `${locale}: card head must name the sentiment provider`).toContain('Alternative.me')
      expect(head, `${locale}: card head must name the skew provider`).toContain('Deribit')
    }
  })

  it('keeps the skew axis label whole: name stem plus the unit in its own brackets', () => {
    // 轴说明是 figcaption 的整句，组件里不许再把 `名字（单位）` 拼一次（架构师 2026-11-22 打回）：
    // 判据断在值上——必须含名字主体（去掉行名里那截「（Deribit）」）与带括号的单位，中英括号各按全角/半角。
    const stem = (name: string): string =>
      name.replace(/（[^）]*）\s*$/u, '').replace(/\s*\([^)]*\)\s*$/u, '').trim()
    for (const locale of ['zh-CN', 'en-US'] as const) {
      const name = stem(valueOf(locale, 'skew.name'))
      const unit = valueOf(locale, 'skew.unit')
      const axis = valueOf(locale, 'skew.axis')
      expect(name, `${locale}: skew.name missing`).not.toBe('')
      expect(unit, `${locale}: skew.unit missing`).not.toBe('')
      expect(axis, `${locale}: skew.axis must carry the instrument and skew name`).toContain(name)
      expect(axis, `${locale}: skew.axis must carry the unit in brackets`).toContain(
        locale === 'zh-CN' ? `（${unit}）` : `(${unit})`
      )
    }
  })

  it('says which failure each unavailable line is, and keeps a dated "stops at" line', () => {
    // AC-11：偏斜读不到要按原因分句（连接 / 源不可用 / 读取失败），三句不许抄成同一句；
    // AC-37/43：偏旧的药丸旁边要有「数据停在 {date}」，{dat} 是源日，不是时刻。
    for (const locale of ['zh-CN', 'en-US'] as const) {
      const lines = UNAVAILABLE_PATHS.map((path) => valueOf(locale, path))
      expect(lines.every((line) => line.trim() !== ''), `${locale}: unavailable lines empty`).toBe(true)
      expect(new Set(lines).size, `${locale}: unavailable lines must differ`).toBe(lines.length)
      const stopsAt = valueOf(locale, 'stale.stopsAt')
      expect(stopsAt, `${locale}: stale.stopsAt needs {date}`).toContain('{date}')
      expect(stopsAt, `${locale}: stale.stopsAt must not print an instant`).not.toContain('{time}')
    }
  })

  it('keeps the skew history row about readings, not calendar days', () => {
    // 这一行讲「偏斜自哪天开始记录、还差几个读数」（PRD :203 / 定稿 §5.3），不是「满一年分位」那件事。
    // 判据断在占位符与词上：remaining 必须同时带 {date} 与 {n}，
    // 且不许出现「天 / 年 / 周」这类日历单位——用日历说法就是语义又漂回分位满一年。
    // `history.since` 已按用户 2026-11-22 的裁定删键（起始日由这一句承担），所以只剩这一条。
    const zhLeaves = leaves(block('zh-CN'), '', [])
    const enLeaves = leaves(block('en-US'), '', [])
    const pick = (list: Leaf[], path: string): string => list.find((leaf) => leaf.path === path)?.value ?? ''
    const calendar = /天|年|周|\b(?:days?|weeks?|months?|years?)\b/iu
    for (const [locale, list] of [
      ['zh-CN', zhLeaves],
      ['en-US', enLeaves]
    ] as const) {
      const remaining = pick(list, 'history.remaining')
      expect(remaining, `${locale}: history.remaining needs {date}`).toContain('{date}')
      expect(remaining, `${locale}: history.remaining needs {n}`).toContain('{n}')
      expect(remaining, `${locale}: history.remaining must not count calendar time`).not.toMatch(calendar)
    }
  })

  it('keeps one direction vocabulary: each direction slot word reappears in that direction\'s verdict lines', () => {
    // 2026-11-22 用户口径（Chief 转）：一套词。方向位印「走阔/收窄/基本没动」（英 Widening/Narrowing/Little changed），
    // 结论句必须用同一个词，不许方向位说 Steeper、结论句说 widening 各说一套。
    // 判据断在值上：方向位的词必须原样出现在四个档位（含缺半句）的同方向结论里——改了一侧漏了另一侧就红。
    for (const locale of ['zh-CN', 'en-US'] as const) {
      const list = locale === 'zh-CN' ? zh : en
      const pick = (path: string): string => list.find((leaf) => leaf.path === path)?.value ?? ''
      const findings: string[] = []
      for (const direction of ['steeper', 'flatter', 'flat'] as const) {
        const slot = pick(`skew.direction.${direction}`)
        expect(slot, `${locale}: skew.direction.${direction} missing`).not.toBe('')
        for (const band of ['fear', 'greed', 'neutral', 'fgMissing'] as const) {
          const line = pick(`verdict.${band}.${direction}`)
          expect(line, `${locale}: verdict.${band}.${direction} missing`).not.toBe('')
          if (!line.toLowerCase().includes(slot.toLowerCase())) {
            findings.push(`${locale} verdict.${band}.${direction} 未用方向位的词「${slot}」`)
          }
        }
      }
      expect(findings).toEqual([])
    }
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