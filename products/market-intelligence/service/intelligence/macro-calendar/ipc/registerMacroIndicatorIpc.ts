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
    ...(fact.consensus === undefined ? {} : { consensus: fact.consensus }),
    // 上一期那个数的出处：只送数字的话，读者分不清它是官方序列还是首发布值，也看不出观测时刻。
    ...(fact.previousSource === undefined ? {} : { previousSource: fact.previousSource }),
    ...(fact.previousObservedAt === undefined ? {} : { previousObservedAt: fact.previousObservedAt }),
    ...(fact.previousUnreadable === true ? { previousUnreadable: true } : {}),
    ...(fact.next === undefined ? {} : { next: nextReleasePayload(fact.next) })
  }
}

/**
 * 下一期：排期 + 预期。**这一层也要逐项列出**——它曾经漏掉整个 `next`，
 * 于是渲染层永远拿不到下次发布与倒计时，卡片看起来「什么数据都没有」（2026-11-14 真机就是这个）。
 *
 * 嵌套结构同样逐项写：`expected` 里带 `provenance` 与（仅盘口的）成交量，
 * 没有值就只给原因；`timePrecision` 一定带上，否则日期型排期会被拿去倒计时。
 */
function nextReleasePayload(next: NonNullable<MacroIndicatorCardFact['next']>): Readonly<Record<string, unknown>> {
  return {
    period: next.period,
    releaseAt: next.releaseAt,
    ...(next.timePrecision === undefined ? {} : { timePrecision: next.timePrecision }),
    ...(next.expected === undefined ? {} : {
      expected: {
        value: next.expected.value,
        provenance: next.expected.provenance,
        asOf: next.expected.asOf,
        ...(next.expected.marketVolume === undefined ? {} : { marketVolume: next.expected.marketVolume })
      }
    }),
    ...(next.expectedState === undefined ? {} : { expectedState: next.expectedState })
  }
}

function canonicalAsOf(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const value = (payload as { asOf?: unknown }).asOf
  return typeof value === 'string' && macroIndicatorAsOfPolicy.canonicalUtcMillisPattern.test(value) ? value : undefined
}
