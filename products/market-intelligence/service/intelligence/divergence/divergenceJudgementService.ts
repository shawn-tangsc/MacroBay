import { resolveConfiguredModel } from '@platform/ai/model-defaults/configuredDefaultModel'
import type { StructuredModelTaskRequest, StructuredModelTaskResult } from '@platform/ai/invocation/structuredModelInvocationTypes'
import type { ModelDefaultsSettings } from '@platform/settings/schema/appSettings'

import type { DivergenceLeg, DivergencePairId, DivergenceRow } from '../../../contracts/marketDivergence'
import { divergencePolicy } from '../../../contracts/marketDivergence'

/**
 * The judgement the card shows, written by the assistant's default model from the four readings.
 *
 * The rules still gather the legs and still answer when the model cannot: a dashboard must not go
 * blank because a provider is off. What changes is who decides *whether* two legs disagree and
 * what it means — that sentence is a reading of the numbers, and a model reads it better than a
 * threshold table. The card then says which of the two wrote it.
 */
export type DivergenceJudgementInput = Readonly<{
  asOf: string
  /** Every pair with its legs, including the ones the rules found no divergence in. */
  pairs: readonly Readonly<{
    pairId: DivergencePairId
    legs: readonly DivergenceLeg[]
    ruleVerdict: 'divergence' | 'agreement'
  }>[]
}>

export type DivergenceJudgement = Readonly<{
  pairId: DivergencePairId
  verdict: 'divergence' | 'agreement'
  direction?: 'bearish' | 'bullish' | 'unpriced'
  /** One line: what the two readings mean together. */
  mechanism?: string
  /** One line: what would make this false. */
  invalidation?: string
}>

export type DivergenceJudgementResult =
  | Readonly<{ state: 'judged'; judgements: readonly DivergenceJudgement[]; modelRef: string }>
  | Readonly<{ state: 'unavailable'; reason: 'no-model' | 'failed' | 'invalid' }>

export type DivergenceModelInvoker = <T>(
  request: StructuredModelTaskRequest<T>
) => Promise<StructuredModelTaskResult<T>>

const MAXIMUM_SENTENCE = 120
const CACHE_TTL_MS = 30 * 60 * 1_000

/**
 * Cached by the readings themselves: the same five numbers on the same day must not cost a model
 * call every time the reader switches tab.
 */
export function createDivergenceJudgementService(deps: {
  invoke: DivergenceModelInvoker
  getProviderState?: () => Promise<{ providers: Parameters<typeof resolveConfiguredModel>[0]['providers'] } | undefined>
  getModelDefaults?: () => Promise<ModelDefaultsSettings | undefined>
  now?: () => number
}) {
  const cache = new Map<string, { at: number; value: DivergenceJudgementResult }>()

  return {
    async judge(input: DivergenceJudgementInput): Promise<DivergenceJudgementResult> {
      const key = judgementKey(input)
      const now = deps.now?.() ?? Date.now()
      const cached = cache.get(key)
      if (cached && now - cached.at < CACHE_TTL_MS) return cached.value

      const value = await judgeUncached(deps, input)
      if (value.state === 'judged') cache.set(key, { at: now, value })
      return value
    },
    /** Exposed for tests: the cache is in-process and must not grow without bound. */
    clear(): void { cache.clear() }
  }
}

async function judgeUncached(
  deps: Parameters<typeof createDivergenceJudgementService>[0],
  input: DivergenceJudgementInput
): Promise<DivergenceJudgementResult> {
  const [providerState, modelDefaults] = await Promise.all([
    deps.getProviderState?.().catch(() => undefined) ?? Promise.resolve(undefined),
    deps.getModelDefaults?.().catch(() => undefined) ?? Promise.resolve(undefined)
  ])
  const resolved = resolveConfiguredModel({
    value: modelDefaults?.assistantModelId ?? '',
    providers: providerState?.providers ?? [],
    isModelAcceptable: (_provider, model) => model.capabilities.chat === true
  })
  if (!resolved.ok) return { state: 'unavailable', reason: 'no-model' }

  let invalid = false
  const result = await deps.invoke<readonly DivergenceJudgement[] | null>({
    taskId: 'market-intelligence.divergence-judgement',
    providerId: resolved.ref.providerId,
    modelId: resolved.ref.modelId,
    messages: [...buildDivergenceMessages(input)],
    parse: (value: unknown) => {
      const text = typeof value === 'string' ? value : extractText(value)
      const parsed = parseJudgementOutput(text, input)
      if (parsed === null) invalid = true
      return parsed
    }
  })
  if (!result.ok) return { state: 'unavailable', reason: 'failed' }
  if (!result.output) return { state: 'unavailable', reason: invalid ? 'invalid' : 'failed' }
  return { state: 'judged', judgements: result.output, modelRef: `${resolved.ref.providerId}:${resolved.ref.modelId}` }
}

/**
 * The prompt states the readings and nothing else, and forbids inventing numbers: the model is
 * writing the sentence between two numbers it was given, not producing new readings.
 */
export function buildDivergenceMessages(input: DivergenceJudgementInput): readonly Readonly<{ role: 'system' | 'user' | 'assistant'; content: string }>[] {
  const legs = input.pairs.map(pair => ({
    pair: pair.pairId,
    ruleSaid: pair.ruleVerdict,
    readings: pair.legs.map(leg => ({ id: leg.id, value: leg.value, unit: leg.unit, at: leg.observedAt }))
  }))
  return [
    {
      role: 'system',
      content: [
        '你是加密市场分析师。给定几组读数，判断每一组里的两条腿是否指向相反方向。',
        '只输出 JSON：{"judgements":[{"pair":"<pair id>","verdict":"divergence|agreement","direction":"bearish|bullish|unpriced","mechanism":"...","invalidation":"..."}]}',
        '规则：',
        '1. 只能使用输入里给出的数字，禁止编造或换算成其它数字；数字必须逐字来自输入。',
        '2. verdict=agreement 时不要写 mechanism 与 invalidation。',
        '3. verdict=divergence 时，direction 取 bearish（偏空）/ bullish（偏强）/ unpriced（消息未被计价）。',
        '4. mechanism 一句话（≤60 字）说明两条腿为何矛盾；invalidation 一句话（≤60 字）说明什么情况下这条不成立。',
        '5. 不要给交易建议，不要预测价格。',
        '6. pair 必须是输入里出现过的 id，每个 id 恰好一次。'
      ].join('\n')
    },
    { role: 'user', content: JSON.stringify({ asOf: input.asOf, pairs: legs }) }
  ]
}

/** Strict: an unknown pair, a missing verdict, or extra prose all count as invalid. */
export function parseJudgementOutput(raw: string, input: DivergenceJudgementInput): readonly DivergenceJudgement[] | null {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let value: unknown
  try { value = JSON.parse(raw.slice(start, end + 1)) } catch { return null }
  if (!value || typeof value !== 'object') return null
  const list = (value as { judgements?: unknown }).judgements
  if (!Array.isArray(list) || list.length === 0) return null

  const known = new Set(input.pairs.map(pair => pair.pairId))
  const seen = new Set<string>()
  const out: DivergenceJudgement[] = []
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') return null
    const record = entry as Record<string, unknown>
    const pairId = record.pair
    if (typeof pairId !== 'string' || !known.has(pairId as DivergencePairId) || seen.has(pairId)) return null
    seen.add(pairId)
    if (record.verdict !== 'divergence' && record.verdict !== 'agreement') return null
    if (record.verdict === 'agreement') {
      out.push({ pairId: pairId as DivergencePairId, verdict: 'agreement' })
      continue
    }
    if (record.direction !== 'bearish' && record.direction !== 'bullish' && record.direction !== 'unpriced') return null
    const mechanism = typeof record.mechanism === 'string' ? record.mechanism.trim() : ''
    const invalidation = typeof record.invalidation === 'string' ? record.invalidation.trim() : ''
    if (!mechanism || !invalidation) return null
    if (mechanism.length > MAXIMUM_SENTENCE || invalidation.length > MAXIMUM_SENTENCE) return null
    out.push({ pairId: pairId as DivergencePairId, verdict: 'divergence', direction: record.direction, mechanism, invalidation })
  }
  // Every pair must be answered: a silent pair would read as "no divergence", which is a claim.
  return seen.size === known.size ? out : null
}

/** The cache key is the readings, not the clock: an unchanged dashboard costs nothing. */
function judgementKey(input: DivergenceJudgementInput): string {
  return input.pairs
    .map(pair => `${pair.pairId}:${pair.ruleVerdict}:${pair.legs.map(leg => `${leg.id}=${leg.value}@${leg.observedAt}`).join(',')}`)
    .join('|')
}

/** Rows the card draws when the model answered. */
export function rowsFromJudgements(
  judgements: readonly DivergenceJudgement[],
  pairs: readonly Readonly<{ pairId: DivergencePairId; legs: readonly DivergenceLeg[] }>[]
): readonly DivergenceRow[] {
  const order = divergencePolicy.pairs
  return judgements
    .filter((judgement): judgement is DivergenceJudgement & { verdict: 'divergence'; direction: 'bearish' | 'bullish' | 'unpriced'; mechanism: string; invalidation: string } => judgement.verdict === 'divergence')
    .sort((left, right) => order.indexOf(left.pairId) - order.indexOf(right.pairId))
    .flatMap(judgement => {
      const pair = pairs.find(entry => entry.pairId === judgement.pairId)
      if (!pair) return []
      return [Object.freeze({
        pairId: judgement.pairId,
        direction: judgement.direction,
        legs: Object.freeze(pair.legs.map(leg => Object.freeze({ ...leg }))),
        judgedBy: 'ai' as const,
        mechanism: judgement.mechanism,
        invalidation: judgement.invalidation
      })]
    })
}

/** The platform hands back the raw model value; only its text is of interest here. */
function extractText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    for (const key of ['text', 'content', 'raw']) {
      if (typeof record[key] === 'string') return record[key]
    }
  }
  return ''
}
