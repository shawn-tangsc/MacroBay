import type { NewsSentimentJudgment, NewsSentimentSymbol } from '../schema/newsSentiment'
import { NEWS_SENTIMENT_LIMITS } from '../schema/newsSentiment'

type RuleHit = {
  reasonCode: string
  polarity: 'bullish' | 'bearish'
  strength: number
  confidence: number
  pattern: RegExp
}

/**
 * 规则只用标题与摘要，不依赖正文：它是模型不可用时的兜底，不是主引擎。
 * 顺序有意义——下架必须先于上架（"Will Delist" 里含 "list"），事故必须先于一般公告。
 *
 * **分档与模型是同一把尺**（`NEWS_SENTIMENT_STRENGTH_SCALE`，1–5 五档，用户 2026-11-18 批准）：
 * 事故/入侵 = 5（可能改变趋势的冲击）；停机、下架、ETF 批准、执法 = 4（直接影响 BTC/ETH 的
 * 资金流或供需）；上架 = 3（影响一类资产的预期）；没有命中 = 1 + 中性（与加密市场无关或没有方向）。
 * 兜底时模型不在，所以这把尺子只能靠这里的分值表达——**改档位等于改语义**，别顺手调数。
 */
const RULES: readonly RuleHit[] = [
  {
    reasonCode: 'news.exploit.v1',
    polarity: 'bearish',
    strength: 5,
    confidence: 80,
    pattern: /\b(hack(?:ed|ing)?|exploit(?:ed|ing)?|drained|stolen|breach(?:ed)?|rug\s?pull)\b/i
  },
  {
    reasonCode: 'news.halt.v1',
    polarity: 'bearish',
    strength: 4,
    confidence: 70,
    pattern: /\b(halt(?:ed|ing)?|suspend(?:ed|ing)?|deposits? paused|withdrawals? paused|trading paused)\b/i
  },
  {
    reasonCode: 'news.delisting.v1',
    polarity: 'bearish',
    strength: 4,
    confidence: 75,
    pattern: /\b(delist(?:ed|ing)?|monitoring tag|cease trading|will cease)\b/i
  },
  {
    reasonCode: 'news.listing.v1',
    polarity: 'bullish',
    strength: 3,
    confidence: 70,
    pattern: /\b(will list|listing|launch(?:es|ed|ing)?\b[^.]{0,60}\bperpetual|perpetual contract)\b/i
  },
  {
    reasonCode: 'news.etf-approval.v1',
    polarity: 'bullish',
    strength: 4,
    confidence: 75,
    pattern: /\betf\b[\s\S]{0,80}\bapprov(?:e|es|ed|al|ing)\b|\bapprov(?:e|es|ed|al|ing)\b[\s\S]{0,80}\betf\b/i
  },
  {
    reasonCode: 'news.enforcement.v1',
    polarity: 'bearish',
    strength: 4,
    confidence: 75,
    pattern: /\b(enforcement|lawsuit|charges|charged|penalty|investigation|fine|cease[- ]and[- ]desist)\b/i
  }
]

const BTC_RE = /\b(bitcoin|btc)\b/i
const ETH_RE = /\b(ethereum|ether|eth)\b/i

/**
 * Deterministic fallback used when no model is callable or its output fails validation.
 *
 * **没有命中就是没有判定**（2026-11-18 修）：以前这里返回 `neutral / strength 1 / news.no-rule.v1`，
 * 于是一条「规则没命中」的行情新闻在界面上被显示成「中性 · 低」，还连锁影响重要性、桌面通知与
 * 按条解读的准入——把「没判」写成了「判为低」。现在返回 `undefined`：调用方据此**不写判定行**，
 * 这条保持「未判定」，等模型下一轮判（评分候选的判据是「不是当前判定」，没有行就会被重新捡起）。
 *
 * 只有真正命中的六条规则才产出判定，且分档与模型用同一把尺（见文件头）。
 */
export function scoreNewsWithRules(input: { title: string; summary?: string }): NewsSentimentJudgment | undefined {
  const text = `${input.title} ${input.summary ?? ''}`.trim()
  const symbols = extractSymbols(text)
  const rule = RULES.find((entry) => entry.pattern.test(text))
  if (!rule) return undefined

  return {
    polarity: rule.polarity,
    strength: rule.strength,
    confidence: rule.confidence,
    symbols,
    reasonCode: rule.reasonCode,
    evidenceQuote: truncate(input.title),
    caveats: []
  }
}

function extractSymbols(text: string): NewsSentimentSymbol[] {
  const symbols: NewsSentimentSymbol[] = []
  if (BTC_RE.test(text)) symbols.push('BTC')
  if (ETH_RE.test(text)) symbols.push('ETH')
  return symbols
}

function truncate(value: string): string {
  const clean = value.trim()
  if (clean.length <= NEWS_SENTIMENT_LIMITS.evidenceQuoteChars) return clean
  return `${clean.slice(0, NEWS_SENTIMENT_LIMITS.evidenceQuoteChars - 1)}…`
}

/**
 * Routine exchange notices (maintenance windows, API/system upgrades, read-only windows) are
 * operationally relevant to the venue's users but carry no directional price signal. They must
 * not occupy the "key sentiment" list merely because the classifier correctly calls them neutral.
 */
const ROUTINE_NOTICE_RE = /\b(?:scheduled\s+)?maintenance\b|\bsystem\s+(?:upgrade|update)\b|\bapi\s+(?:upgrade|update|maintenance)\b|\bread-only\b|\btemporarily\s+unavailable\b|\btrading\s+hours\b|\bholiday\s+(?:notice|schedule)\b/i

export function isRoutineNewsNotice(input: {
  title: string
  polarity: string
  strength: number
}): boolean {
  if (input.polarity !== 'neutral') return false
  if (input.strength > 2) return false
  return ROUTINE_NOTICE_RE.test(input.title)
}
