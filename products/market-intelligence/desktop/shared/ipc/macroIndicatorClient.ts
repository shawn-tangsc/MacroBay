import {
  MACRO_INDICATOR_CARD_KEYS, type MacroIndicatorCardFact, type MacroIndicatorCardKey
} from '../../../service/intelligence/macro-calendar/macroIndicatorCardFacts'
import { MACRO_INDICATOR_IPC_METHODS } from '../../../service/intelligence/macro-calendar/ipc/registerMacroIndicatorIpc'

const productId = 'market-intelligence'

export type MacroIndicatorReadResult =
  | Readonly<{ state: 'available'; asOf: string; facts: readonly MacroIndicatorCardFact[] }>
  | Readonly<{ state: 'unavailable'; failureCode: string }>

export const macroIndicatorClient = {
  async read(asOf: string): Promise<MacroIndicatorReadResult> {
    return sanitize(await invoke(MACRO_INDICATOR_IPC_METHODS.read, { asOf }))
  }
}

async function invoke(method: string, payload: unknown): Promise<unknown> {
  try {
    if (!window.platform?.products?.invoke) return undefined
    return await window.platform.products.invoke(productId, method, payload)
  } catch {
    return undefined
  }
}

/**
 * 渲染层只接受**完整的四张卡**：这张接口只回答四个指标，少一张就说明这一趟没读全，
 * 那不是「其中一张没有值」——半份事实比没有事实更容易被当成真读数。
 */
export function sanitize(value: unknown): MacroIndicatorReadResult {
  if (!isObject(value)) return unavailable('malformed')
  if (value.state === 'unavailable') return unavailable(typeof value.failureCode === 'string' ? value.failureCode : 'unavailable')
  if (value.state !== 'available' || typeof value.asOf !== 'string') return unavailable('malformed')
  const facts = readFacts(value.facts)
  return facts ? { state: 'available', asOf: value.asOf, facts } : unavailable('malformed')
}

function readFacts(value: unknown): readonly MacroIndicatorCardFact[] | undefined {
  if (!Array.isArray(value)) return undefined
  const facts = value.flatMap((entry) => {
    const fact = readFact(entry)
    return fact === undefined ? [] : [fact]
  })
  const keys = new Set(facts.map((fact) => fact.metricKey))
  return facts.length === MACRO_INDICATOR_CARD_KEYS.length && MACRO_INDICATOR_CARD_KEYS.every((key) => keys.has(key))
    ? facts
    : undefined
}

/**
 * 一张卡的形状：三态之一 + 可选的期次/值/上一期。
 *
 * 读不懂的那一条直接丢（`flatMap` 里返回空），绝不把半个事实补成 0。
 */
function readFact(value: unknown): MacroIndicatorCardFact | undefined {
  if (!isObject(value) || !isCardKey(value.metricKey)) return undefined
  if (value.state !== 'provided' && value.state !== 'missing-current' && value.state !== 'not-recorded') return undefined
  const value_ = isFiniteNumber(value.value) ? value.value : undefined
  const previous = isFiniteNumber(value.previousAsPublished) ? value.previousAsPublished : undefined
  return {
    metricKey: value.metricKey,
    state: value.state,
    ...(typeof value.period === 'string' ? { period: value.period } : {}),
    ...(typeof value.releasedAt === 'string' ? { releasedAt: value.releasedAt } : {}),
    ...(value_ === undefined ? {} : { value: value_ }),
    ...(previous === undefined ? {} : { previousAsPublished: previous }),
    ...(value.unit === 'percent' || value.unit === 'thousands' ? { unit: value.unit } : {}),
    ...(value.source === 'narwhal' || value.source === '0xrouter' ? { source: value.source } : {}),
    ...(readConsensus(value.consensus) === undefined ? {} : { consensus: readConsensus(value.consensus)! })
  }
}

/**
 * 共识：**五元组**（值 + 期次 + `asOf` + 出处 + 盘口才要的成交量）。缺任何一样就当没有——
 * 半个共识比没有更像答案。今天只有 `source-survey` 一档。
 */
function readConsensus(value: unknown): Readonly<{ value: number; provenance: 'source-survey'; asOf: string; sourceName: string }> | undefined {
  if (!isObject(value) || value.provenance !== 'source-survey') return undefined
  if (!isFiniteNumber(value.value) || typeof value.asOf !== 'string' || typeof value.sourceName !== 'string') return undefined
  if (value.sourceName === '' || !Number.isFinite(Date.parse(value.asOf))) return undefined
  return { value: value.value, provenance: 'source-survey', asOf: value.asOf, sourceName: value.sourceName }
}

function isCardKey(value: unknown): value is MacroIndicatorCardKey {
  return typeof value === 'string' && (MACRO_INDICATOR_CARD_KEYS as readonly string[]).includes(value)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function unavailable(failureCode: string): MacroIndicatorReadResult {
  return { state: 'unavailable', failureCode }
}
