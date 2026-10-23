import type { AppLanguage } from '@platform/settings/schema/appSettings'

import { toReadableConclusionText, type MarketAnalysisReadableLocale, type MarketAnalysisReadableNames } from '../../../contracts/marketAnalysisReadableText'
import { productText } from '../../shared/i18n/productText'

/**
 * Directional conclusion policy.
 *
 * `AnalysisSummary.eventAssessment` is free text, so a surface that colours a
 * direction must never guess: it reads an explicit marker. The marker is a fixed
 * controlled vocabulary; a conclusion without a marker stays unstyled instead of
 * being classified by keyword luck. The model contract requires the marker at
 * the start of `eventAssessment` (see `analysisModelPrompt.ts`).
 *
 * Each direction owns one existing semantic colour token from the crypto
 * dashboard token set, so the workspace shows the same up/down language the rest
 * of the product already uses.
 */
export const analysisConclusionDirectionPolicy = Object.freeze({
  /** 协议标记的两种写法：中文界面用「方向：」，英文界面用「Direction: 」。 */
  markerPrefixes: ['方向', 'Direction'] as const,
  markers: Object.freeze({
    bullish: '偏多',
    bearish: '偏空',
    range: '震荡',
    undecided: '暂不判断',
    mixed: '信号冲突'
  }),
  /**
   * Marker term -> workspace-local semantic colour variable. The workspace owns
   * these three variables so it does not depend on the dashboard stylesheet
   * being mounted; they carry the same up/down language the dashboard uses.
   */
  /** 历史结论总是中文，渲染时用它做兜底；当前语言标签见 `localizedDirectionTerm`。 */
  terms: Object.freeze({ bullish: '偏多', bearish: '偏空', range: '震荡', undecided: '暂不判断', mixed: '信号冲突' }),
  colorTokens: Object.freeze({
    bullish: '--mi-conclusion-positive',
    bearish: '--mi-conclusion-negative',
    range: '--mi-conclusion-caution',
    undecided: '--muted-strong',
    mixed: '--mi-conclusion-caution'
  })
})

export type AnalysisConclusionDirection = keyof typeof analysisConclusionDirectionPolicy.markers

/**
 * 方向 key 或历史中文术语 -> 方向 key；展示时再落到读者当前语言。
 *
 * New summaries store the key (`bearish`); summaries published before the structured contract hold
 * the Chinese term (`偏空`). Both resolve to the same key here, which is what colours the panel.
 */
export function analysisDirectionKey(term: string): AnalysisConclusionDirection | undefined {
  const normalized = term.trim()
  const keys = Object.keys(analysisConclusionDirectionPolicy.markers) as AnalysisConclusionDirection[]
  return keys.find(key =>
    normalized === key
    || normalized === analysisConclusionDirectionPolicy.markers[key]
    || normalized.startsWith(analysisConclusionDirectionPolicy.markers[key]))
}

/** 协议术语（或已经解析出的方向 key）-> 当前语言的读者标签；未登记的值原样返回。 */
export function localizedDirectionTerm(termOrKey: string, language: AppLanguage): string {
  const key = analysisDirectionKey(termOrKey) ?? directionKeyOrUndefined(termOrKey)
  if (!key) return termOrKey
  return productText[language].pages.intelligence.portal.analysisWorkspace.conclusionDirection[key]
}

function directionKeyOrUndefined(value: string): AnalysisConclusionDirection | undefined {
  const keys = Object.keys(analysisConclusionDirectionPolicy.markers) as AnalysisConclusionDirection[]
  return keys.find(key => key === value)
}

export type ParsedConclusion = Readonly<{
  /** Undefined when the published conclusion carries no explicit marker. */
  direction?: AnalysisConclusionDirection
  /** Marked direction, or the whole text when there is no marker, with identifiers named. */
  body: string
}>

/**
 * Reads `方向：<term>` from the start of a conclusion. Returns the direction and the
 * remaining body. Text without a marker is returned unchanged so the caller can render it
 * neutrally.
 *
 * `readableNames` is the product i18n vocabulary for the analysis identifiers. Conclusions
 * published before the model was given readable field names still quote them
 * (`change-1d-usd`, `consensus`), and every surface reads its text through here, so the
 * projection happens once, in one place. Without the vocabulary the text is returned exactly
 * as published.
 */
export function parseConclusionDirection(
  assessment: string,
  readableNames?: MarketAnalysisReadableNames,
  locale: MarketAnalysisReadableLocale = 'zh-CN'
): ParsedConclusion {
  const readable = (body: string): string => readableNames ? toReadableConclusionText(body, readableNames, locale) : body
  // Legacy summaries only: they carry the Chinese marker, and the structured contract has no
  // marker to read at all.
  const match = /^\s*方向\s*[：:]\s*([\s\S]+)$/u.exec(assessment)
  if (!match) return { body: readable(assessment) }
  const inner = match[1]!.trim()
  const separatorIndex = inner.search(/[：:]/)
  const term = separatorIndex >= 0 ? inner.slice(0, separatorIndex).trim() : inner
  const body = separatorIndex >= 0 ? inner.slice(separatorIndex + 1).trim() : ''
  const direction = analysisDirectionKey(term)
  if (!direction) return { body: readable(assessment) }
  return { direction, body: readable(body) }
}
