import { MARKET_ANALYSIS_ERROR_CODES } from '../../../contracts/marketAnalysisContracts'
import {
  NEWS_INTERPRETATION_FAILURE_CODES, NEWS_INTERPRETATION_INSUFFICIENT_REASONS,
  type NewsInterpretationFailureCode, type NewsInterpretationInsufficientReason
} from '../../../contracts/marketAnalysisIpcContracts'

/**
 * 「AI 解读」请求没跑起来时，结果条显示哪一句、给哪个动作（R37 §9.4）。
 *
 * 只返回**文案键与动作 token**：可见文案零字面量，句子由渲染方用 `resolveText` 取。
 * 动作是闭集，界面据此接设置页 / 重试 / 刷新 / 查看原因，不去匹配句子。
 *
 * **表外的码一律落兜底**，不把 `analysis-*` 全量直通：界面每加一个码就要加一句，而多数码
 * 读者无从行动（先例：`analysisManualFailureNotifier` 的兜底句）。
 */
export type NewsInterpretationResultAction =
  | 'open-settings'
  | 'retry'
  | 'refresh'
  | 'details'
  | null

type CopyEntry = Readonly<{ sentenceKey: string; action: NewsInterpretationResultAction; actionKey?: string }>

const BASE = 'pages.intelligence.portal.dashboard.newsInterpretationResult'
const state = (code: string): CopyEntry => ({
  sentenceKey: `${BASE}.states.${code}.sentence`,
  action: ACTIONS[code] ?? null,
  ...(ACTIONS[code] ? { actionKey: `${BASE}.states.${code}.action` } : {})
})
const insufficient = (reason: NewsInterpretationInsufficientReason): CopyEntry => state(`insufficient-facts:${reason}`)
const ACTIONS: Readonly<Record<string, NewsInterpretationResultAction>> = Object.freeze({
  'analysis-not-enabled': 'open-settings',
  'analysis-provider-not-ready': 'open-settings',
  'analysis-initial-request-unavailable': 'retry',
  'analysis-initial-request-failed': 'retry',
  'analysis-event-group-not-found': 'refresh',
  'insufficient-facts:trigger-evidence-missing': 'details',
  'insufficient-facts:market-facts-below-minimum': 'details',
  // 运行被打断/卡住：它没跑完，重试是唯一有用的动作（设置、刷新、看原因都不对路）。
  [MARKET_ANALYSIS_ERROR_CODES.runInterrupted]: 'retry'
})

const BY_CODE: Readonly<Record<NewsInterpretationFailureCode, CopyEntry>> = Object.freeze({
  [NEWS_INTERPRETATION_FAILURE_CODES.notEnabled]: state(NEWS_INTERPRETATION_FAILURE_CODES.notEnabled),
  [NEWS_INTERPRETATION_FAILURE_CODES.providerNotReady]: state(NEWS_INTERPRETATION_FAILURE_CODES.providerNotReady),
  [NEWS_INTERPRETATION_FAILURE_CODES.requestUnavailable]: state(NEWS_INTERPRETATION_FAILURE_CODES.requestUnavailable),
  [NEWS_INTERPRETATION_FAILURE_CODES.requestFailed]: state(NEWS_INTERPRETATION_FAILURE_CODES.requestFailed),
  [NEWS_INTERPRETATION_FAILURE_CODES.eventGroupNotFound]: state(NEWS_INTERPRETATION_FAILURE_CODES.eventGroupNotFound)
})

/** 写端点两个「本来就不该开始」的结局：与失败码、与兜底句都不是同一句话。 */
export type NewsInterpretationResultState = 'no-judgment' | 'not-eligible'

const BY_STATE: Readonly<Record<NewsInterpretationResultState, CopyEntry>> = Object.freeze({
  'no-judgment': state('no-judgment'),
  'not-eligible': state('not-eligible')
})

/**
 * 运行自己的失败码（不是写端点那套闭集）。`lastRun` 只带 failureCode、不带 detail，
 * 「应用关了」与「运行时卡住」两个成因共用一句。
 */
const BY_RUN_FAILURE_CODE: Readonly<Record<string, CopyEntry>> = Object.freeze({
  [MARKET_ANALYSIS_ERROR_CODES.runInterrupted]: state(MARKET_ANALYSIS_ERROR_CODES.runInterrupted)
})

const BY_INSUFFICIENT: Readonly<Record<NewsInterpretationInsufficientReason, CopyEntry>> = Object.freeze({
  [NEWS_INTERPRETATION_INSUFFICIENT_REASONS.triggerEvidenceMissing]: insufficient(NEWS_INTERPRETATION_INSUFFICIENT_REASONS.triggerEvidenceMissing),
  [NEWS_INTERPRETATION_INSUFFICIENT_REASONS.marketFactsBelowMinimum]: insufficient(NEWS_INTERPRETATION_INSUFFICIENT_REASONS.marketFactsBelowMinimum)
})

const FALLBACK: CopyEntry = Object.freeze({ sentenceKey: `${BASE}.fallback.sentence`, action: null })

export function newsInterpretationResultCopy(input: Readonly<{
  /** 写端点的 `no-judgment` / `not-eligible`：不是失败，是「本来就不该开始」。 */
  state?: string
  failureCode?: string
  /** 只在 `insufficient-facts` 这一档有意义。 */
  insufficientReason?: string
}>): CopyEntry {
  if (input.state !== undefined && input.state in BY_STATE) return BY_STATE[input.state as NewsInterpretationResultState]
  if (input.failureCode !== undefined && input.failureCode in BY_CODE) return BY_CODE[input.failureCode as NewsInterpretationFailureCode]
  if (input.failureCode !== undefined && input.failureCode in BY_RUN_FAILURE_CODE) return BY_RUN_FAILURE_CODE[input.failureCode]
  if (input.insufficientReason !== undefined && input.insufficientReason in BY_INSUFFICIENT) {
    return BY_INSUFFICIENT[input.insufficientReason as NewsInterpretationInsufficientReason]
  }
  return FALLBACK
}

/** 所有会出句子的键（守卫用例逐条解析，确保两种语言都真有这两句）。 */
export const newsInterpretationResultCopyKeys: readonly string[] = Object.freeze([
  ...Object.values(BY_STATE).map(entry => entry.sentenceKey),
  ...Object.values(BY_CODE).map(entry => entry.sentenceKey),
  ...Object.values(BY_RUN_FAILURE_CODE).map(entry => entry.sentenceKey),
  ...Object.values(BY_INSUFFICIENT).map(entry => entry.sentenceKey),
  FALLBACK.sentenceKey
])
