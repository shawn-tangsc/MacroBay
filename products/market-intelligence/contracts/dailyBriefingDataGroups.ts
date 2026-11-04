import type { BriefingMarketRow, BriefingPulseRow, DailyBriefingDocument } from './dailyBriefing'

/**
 * The data region's blocks, decided once for both exports.
 *
 * The card and the copied markdown are two renderers of one edition. When each decided for itself
 * which row belongs where, the same funding rate printed twice (funds group and leverage block) and
 * the leverage and rate-path blocks were missing from the text entirely. So the partition lives
 * here: one function, two consumers, no second opinion about placement.
 *
 * `funding-btc` / `funding-eth` belong to the leverage block, which explains them (direction, open
 * interest, 1h/24h); the funds block keeps stablecoin and the two ETF rows. This cannot be expressed
 * with `visibility` — every row with data is shown — so the split is structural.
 */
export type BriefingDataBlock =
  | Readonly<{ kind: 'price'; row: BriefingMarketRow }>
  | Readonly<{ kind: 'readings'; row: BriefingMarketRow | BriefingPulseRow }>
  | Readonly<{ kind: 'funds'; row: BriefingMarketRow | BriefingPulseRow }>

export type BriefingDataGroups = Readonly<{
  /** BTC and ETH: the two rows that carry a price area and an amplitude. */
  price: readonly BriefingMarketRow[]
  /** Everything read as a number: index, dollar, gold, the two yields, stablecoin, fear and greed. */
  readings: readonly (BriefingMarketRow | BriefingPulseRow)[]
  /** The ETF rows, which are amounts rather than moves. */
  funds: readonly (BriefingMarketRow | BriefingPulseRow)[]
  /** The policy card, when the edition carries one. */
  policyPath: DailyBriefingDocument['data']['policyPath']
  /** Open interest and funding: shown in the leverage block, never in the readings line. */
  leverage: DailyBriefingDocument['data']['leverage']
}>

const PRICE_IDS: ReadonlySet<string> = new Set(['btc', 'eth'])
const FUND_IDS: ReadonlySet<string> = new Set(['etf-btc', 'etf-eth', 'stablecoin'])
/** Funding lives in the leverage block; printing it here too is the duplicate that started this. */
const LEVERAGE_ONLY_FUND_IDS: ReadonlySet<string> = new Set(['funding-btc', 'funding-eth'])

export function briefingDataGroups(document: DailyBriefingDocument): BriefingDataGroups {
  const market = document.data.market.filter((row) => row.visibility !== 'hidden')
  const funds = document.data.funds.filter((row) => row.visibility !== 'hidden' && !LEVERAGE_ONLY_FUND_IDS.has(row.id))
  const sentiment = document.data.sentiment.fearGreed ? [document.data.sentiment.fearGreed] : []
  return Object.freeze({
    price: Object.freeze(market.filter((row) => PRICE_IDS.has(row.id))),
    readings: Object.freeze([
      ...market.filter((row) => !PRICE_IDS.has(row.id)),
      ...funds.filter((row) => FUND_IDS.has(row.id) && row.id === 'stablecoin'),
      ...sentiment
    ]),
    funds: Object.freeze(funds.filter((row) => row.id !== 'stablecoin')),
    policyPath: document.data.policyPath,
    leverage: document.data.leverage
  })
}
