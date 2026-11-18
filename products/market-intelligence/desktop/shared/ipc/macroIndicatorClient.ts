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
    ...(value.source === 'narwhal' || value.source === '0xrouter' || value.source === 'fred' ? { source: value.source } : {}),
    ...(readConsensus(value.consensus) === undefined ? {} : { consensus: readConsensus(value.consensus)! }),
    ...readPreviousProvenance(value),
    ...(readNext(value.next) === undefined ? {} : { next: readNext(value.next)! }),
    ...(readGap(value.gap) === undefined ? {} : { gap: readGap(value.gap)! })
  }
}

/**
 * 「这一格为什么没有数」（产品 41 号文）：待发布 / 无此数据 / 未提供。
 *
 * 形状不对就整块丢掉——把 `structural-no-source` 读成 `source-no-value`（或反过来），
 * 卡上就会把「这一期本来没有」说成「来源忘了给」。两个词在此是**闭集**，不认识的一律不给。
 */
function readGap(value: unknown): MacroIndicatorCardFact['gap'] | undefined {
  if (!isObject(value)) return undefined
  const pending = value.pending
  const pendingOk = isObject(pending) && typeof pending.releaseAt === 'string'
    && Number.isFinite(Date.parse(pending.releaseAt))
  const missing = value.missing
  const reason = isObject(missing) && (missing.reason === 'structural-no-source' || missing.reason === 'source-no-value')
    ? missing.reason
    : undefined
  const basis = isObject(missing) && typeof missing.basis === 'string' && missing.basis !== '' ? missing.basis : undefined
  if (!pendingOk && reason === undefined) return undefined
  return {
    ...(pendingOk
      ? { pending: { releaseAt: (pending as { releaseAt: string }).releaseAt,
        ...(typeof (pending as { period?: unknown }).period === 'string'
          ? { period: (pending as { period: string }).period } : {}) } }
      : {}),
    ...(reason === undefined ? {} : { missing: { reason, ...(basis === undefined ? {} : { basis }) } })
  }
}

/**
 * 上一期那个数的出处。**白名单漏掉它，界面上就只剩一个裸数字**——读者分不清那是官方序列
 * 还是日历库的首发布值，也看不出它是什么时候的（2026-11-14 漏过一次）。
 */
function readPreviousProvenance(value: Record<string, unknown>): Partial<Pick<MacroIndicatorCardFact,
  'previousSource' | 'previousObservedAt' | 'previousUnreadable'>> {
  const source = value.previousSource === 'fred' || value.previousSource === 'release' ? value.previousSource : undefined
  const observedAt = typeof value.previousObservedAt === 'string' && Number.isFinite(Date.parse(value.previousObservedAt))
    ? value.previousObservedAt
    : undefined
  return {
    ...(source === undefined ? {} : { previousSource: source }),
    ...(observedAt === undefined ? {} : { previousObservedAt: observedAt }),
    ...(value.previousUnreadable === true ? { previousUnreadable: true } : {})
  }
}

/**
 * 下一期：排期 + 预期。**有值必然带来源**这一条在这里也成立，不是只在服务层成立：
 * 值在而没有可识别的来源，就当这一格没有值，绝不给它补一个来源。
 */
function readNext(value: unknown): MacroIndicatorCardFact['next'] | undefined {
  if (!isObject(value) || typeof value.period !== 'string' || typeof value.releaseAt !== 'string') return undefined
  if (!Number.isFinite(Date.parse(value.releaseAt))) return undefined
  const timePrecision = value.timePrecision === 'minute' || value.timePrecision === 'date' ? value.timePrecision : undefined
  const expected = readExpected(value.expected)
  const expectedState = value.expectedState === 'no-market' || value.expectedState === 'unreadable' ? value.expectedState : undefined
  return {
    period: value.period,
    releaseAt: value.releaseAt,
    ...(timePrecision === undefined ? {} : { timePrecision }),
    ...(expected === undefined ? {} : { expected }),
    // 有值就不再说「没有值」，两者互斥：同一格既写「暂无」又写数字，是这张卡最糟的样子。
    ...(expected !== undefined || expectedState === undefined ? {} : { expectedState })
  }
}

function readExpected(value: unknown): NonNullable<MacroIndicatorCardFact['next']>['expected'] {
  if (!isObject(value) || !isFiniteNumber(value.value) || typeof value.asOf !== 'string') return undefined
  if (!Number.isFinite(Date.parse(value.asOf))) return undefined
  if (value.provenance === 'market-implied') {
    // 盘口这一档必须带成交量：没有成交量的「市场预期」无法验证，也就不该自称来自盘口。
    return isFiniteNumber(value.marketVolume) && value.marketVolume > 0
      ? { value: value.value, provenance: 'market-implied', asOf: value.asOf, marketVolume: value.marketVolume }
      : undefined
  }
  if (value.provenance === 'source-survey') {
    return { value: value.value, provenance: 'source-survey', asOf: value.asOf }
  }
  return undefined
}

/**
 * 共识：**五元组**（值 + 期次 + `asOf` + 出处 + 盘口才要的成交量）。缺任何一样就当没有——
 * 半个共识比没有更像答案。今天只有 `source-survey` 一档。
 */
function readConsensus(value: unknown): MacroIndicatorCardFact['consensus'] | undefined {
  if (!isObject(value) || value.provenance !== 'source-survey') return undefined
  if (!isFiniteNumber(value.value) || typeof value.asOf !== 'string') return undefined
  if (!Number.isFinite(Date.parse(value.asOf))) return undefined
  return { value: value.value, provenance: 'source-survey', asOf: value.asOf }
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
