import type {
  BriefingMarketRow,
  BriefingPulseRow,
  BriefingValueFormat,
  BriefingWindow,
  DailyBriefingDocument
} from '../../../contracts/dailyBriefing'
import type { DailyBriefFactEnsureEntry } from './dailyBriefFactEnsureCache'
import { combineDailyBriefingReadingStates } from './dailyBriefingDocument'
import type { DailyBriefCoreFactMetric } from './dailyBriefCoreFactPolicy'

/**
 * Turning one cached fact into a document row.
 *
 * Only the value-bearing fields move: the row keeps the selection the edition was generated with
 * (`importance`, `materiality`, `visibility`), and a single backfilled point cannot invent a change
 * window, so `change` is null with the honest `no-baseline` reason. The four-reading summary is
 * recomputed from the funds rows with the builder's own union rule, never a second rule.
 */

type RowDescriptor = Readonly<{
  group: 'market' | 'funds'
  id: BriefingMarketRow['id'] | BriefingPulseRow['id']
  format: BriefingValueFormat
  window: BriefingWindow
}>

const METRIC_ROW: Readonly<Record<DailyBriefCoreFactMetric, RowDescriptor>> = Object.freeze({
  'core-stablecoin-supply-usd': Object.freeze({ group: 'funds', id: 'stablecoin', format: 'usd', window: 'latest' }),
  'etf-net-flow-btc': Object.freeze({ group: 'funds', id: 'etf-btc', format: 'flow-usd', window: 'trading-day' }),
  'etf-net-flow-eth': Object.freeze({ group: 'funds', id: 'etf-eth', format: 'flow-usd', window: 'trading-day' }),
  'dxy-level': Object.freeze({ group: 'market', id: 'dxy', format: 'level', window: 'latest' }),
  'gold-level-usd': Object.freeze({ group: 'market', id: 'gold', format: 'level', window: 'latest' }),
  'us10y-yield-percent': Object.freeze({ group: 'market', id: 'us10y', format: 'yield', window: 'daily' }),
  'us10y-real-yield-percent': Object.freeze({ group: 'market', id: 'us10y-real', format: 'yield', window: 'daily' })
})

export type CoreFactApplication = Readonly<{
  document: DailyBriefingDocument
  filled: readonly DailyBriefCoreFactMetric[]
}>

export function applyCoreFacts(
  document: DailyBriefingDocument,
  facts: ReadonlyMap<DailyBriefCoreFactMetric, DailyBriefFactEnsureEntry>
): CoreFactApplication {
  if (facts.size === 0) return { document, filled: [] }
  const filled: DailyBriefCoreFactMetric[] = []
  const marketById = new Map<BriefingMarketRow['id'], { metric: DailyBriefCoreFactMetric; entry: DailyBriefFactEnsureEntry }>()
  const fundsById = new Map<BriefingPulseRow['id'], { metric: DailyBriefCoreFactMetric; entry: DailyBriefFactEnsureEntry }>()
  for (const [metric, entry] of facts) {
    const descriptor = METRIC_ROW[metric]
    if (descriptor.group === 'funds') fundsById.set(descriptor.id as BriefingPulseRow['id'], { metric, entry })
    else marketById.set(descriptor.id as BriefingMarketRow['id'], { metric, entry })
  }
  const market = document.data.market.map((row) => {
    const found = marketById.get(row.id)
    if (!found) return row
    filled.push(found.metric)
    return patchedRow(row, found.entry, METRIC_ROW[found.metric])
  })
  let fundsChanged = false
  const funds = document.data.funds.map((row) => {
    const found = fundsById.get(row.id)
    if (!found) return row
    fundsChanged = true
    filled.push(found.metric)
    return patchedRow(row, found.entry, METRIC_ROW[found.metric])
  })
  let next: DailyBriefingDocument = Object.freeze({
    ...document,
    data: Object.freeze({
      ...document.data,
      market: Object.freeze(market),
      funds: Object.freeze(funds)
    })
  })
  if (fundsChanged) next = withCapitalReading(next)
  return { document: next, filled }
}

/** The builder's own union rule, imported rather than copied; market rows do not feed it. */
function withCapitalReading(document: DailyBriefingDocument): DailyBriefingDocument {
  const capital = combineDailyBriefingReadingStates(document.data.funds
    .filter((row) => row.id !== 'funding-btc' && row.id !== 'funding-eth')
    .map((row) => row.state))
  const readings = document.status.readings.map((entry) =>
    entry.id === 'capital' ? Object.freeze({ id: 'capital' as const, state: capital }) : entry)
  return Object.freeze({
    ...document,
    status: Object.freeze({
      ...document.status,
      readings: Object.freeze(readings),
      readingsAvailable: readings.filter((entry) => entry.state === 'available').length
    })
  })
}

function patchedRow<T extends BriefingMarketRow | BriefingPulseRow>(
  row: T,
  entry: DailyBriefFactEnsureEntry,
  descriptor: RowDescriptor
): T {
  const { reason: _reason, ...rest } = row
  return Object.freeze({
    ...rest,
    state: 'available' as const,
    value: Object.freeze({ number: entry.value as number, format: descriptor.format }),
    change: null,
    changeReason: 'no-baseline' as const,
    window: descriptor.window,
    observedAt: entry.observedAt as string
  }) as T
}

export function withCoreFactSupplements(
  document: DailyBriefingDocument,
  filled: readonly DailyBriefCoreFactMetric[],
  at: string,
  tool: string
): DailyBriefingDocument {
  return Object.freeze({
    ...document,
    provenance: Object.freeze({
      ...document.provenance,
      supplements: Object.freeze([
        ...(document.provenance.supplements ?? []),
        Object.freeze({
          at,
          tool,
          reason: `filled ${filled.length} core data rows: ${filled.join(', ')}`
        })
      ])
    })
  })
}
