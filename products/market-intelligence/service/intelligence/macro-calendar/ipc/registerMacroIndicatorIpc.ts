import type { ProductIpcRegistrar } from '@platform/desktop/ipc/productIpcRegistry'

import type { MacroIndicatorCardFact } from '../macroIndicatorCardFacts'
import { macroIndicatorAsOfPolicy, type MacroIndicatorReadService } from '../macroIndicatorReadService'

const productId = 'market-intelligence'

/** One read method: the cards never write, so nothing else is exposed. */
export const MACRO_INDICATOR_IPC_METHODS = {
  read: 'intelligence.macro.indicator.read'
} as const

export function registerMacroIndicatorIpc(
  register: ProductIpcRegistrar,
  service: Pick<MacroIndicatorReadService, 'read'>,
  now: () => string = () => new Date().toISOString()
): void {
  register(productId, MACRO_INDICATOR_IPC_METHODS.read, async (payload) => {
    const asOf = canonicalAsOf(payload) ?? now()
    try {
      return { state: 'available' as const, asOf, facts: (await service.read({ asOf })).map(indicatorFactPayload) }
    } catch {
      // 读失败是一件事，不是「这个指标没有值」：`unavailable` 与事实里的三态分得开。
      return { state: 'unavailable' as const, failureCode: 'unreadable' as const }
    }
  })
}

/**
 * 渲染层能看到的字段，**逐项列出**。
 *
 * 不用 `...fact` 再删：那等于默认把以后新增的字段都送出去——`market_fact_key`、原始 `measure`
 * 名这类内部标识一旦挂上 fact，就会跟着一次「顺手加个字段」漏进窗口。
 */
function indicatorFactPayload(fact: MacroIndicatorCardFact): Readonly<Record<string, unknown>> {
  return {
    metricKey: fact.metricKey,
    state: fact.state,
    ...(fact.period === undefined ? {} : { period: fact.period }),
    ...(fact.releasedAt === undefined ? {} : { releasedAt: fact.releasedAt }),
    ...(fact.value === undefined ? {} : { value: fact.value }),
    ...(fact.previousAsPublished === undefined ? {} : { previousAsPublished: fact.previousAsPublished }),
    ...(fact.unit === undefined ? {} : { unit: fact.unit }),
    ...(fact.source === undefined ? {} : { source: fact.source }),
    ...(fact.consensus === undefined ? {} : { consensus: fact.consensus })
  }
}

function canonicalAsOf(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const value = (payload as { asOf?: unknown }).asOf
  return typeof value === 'string' && macroIndicatorAsOfPolicy.canonicalUtcMillisPattern.test(value) ? value : undefined
}
