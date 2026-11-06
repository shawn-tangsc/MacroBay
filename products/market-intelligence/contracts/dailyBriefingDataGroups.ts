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
  /**
   * The market and sentiment line: the index, the dollar, gold, the nominal yield and fear-and-greed.
   * Five cells in three fixed columns, so the second line keeps an empty cell rather than stretching.
   */
  readings: readonly (BriefingMarketRow | BriefingPulseRow)[]
  /**
   * The money line: the two spot funds and the stablecoin supply — flows and a stock, which is why the
   * heading is "funds" and not "flows". Three fixed columns, one cell each.
   */
  funds: readonly (BriefingMarketRow | BriefingPulseRow)[]
  /** The policy card, when the edition carries one. */
  policyPath: DailyBriefingDocument['data']['policyPath']
  /** The edition's cutoff: a block stamps it once, and a row prints its own time only when it differs. */
  windowEnd: string
  /** The issue day, which the rate card's countdown counts from. */
  editionDate: string
  /** Open interest and funding: shown in the leverage block, never in the readings line. */
  leverage: DailyBriefingDocument['data']['leverage']
  /** The funding rows themselves: the leverage block prints the rate from here, nobody re-reads `funds`. */
  funding: readonly BriefingPulseRow[]
}>

const PRICE_IDS: ReadonlySet<string> = new Set(['btc', 'eth'])
/** Funding lives in the leverage block; printing it here too is the duplicate that started this. */
const LEVERAGE_ONLY_FUND_IDS: ReadonlySet<string> = new Set(['funding-btc', 'funding-eth'])
/**
 * The real yield is not one of the six readings the line shows. It appears in the watch list as a
 * sentence; the line carries the nominal yield only, which is what the approved layout draws.
 */
const READINGS_EXCLUDED: ReadonlySet<string> = new Set(['us10y-real'])

export function briefingDataGroups(document: DailyBriefingDocument): BriefingDataGroups {
  const market = document.data.market.filter((row) => row.visibility !== 'hidden')
  const funds = document.data.funds.filter((row) => row.visibility !== 'hidden' && !LEVERAGE_ONLY_FUND_IDS.has(row.id))
  const sentiment = document.data.sentiment.fearGreed ? [document.data.sentiment.fearGreed] : []
  return Object.freeze({
    price: Object.freeze(market.filter((row) => PRICE_IDS.has(row.id))),
    // Order is fixed, never by whether a row moved today: a reader who has seen it once should not
    // have to search for the same cell the next morning.
    readings: Object.freeze([
      ...market.filter((row) => !PRICE_IDS.has(row.id) && !READINGS_EXCLUDED.has(row.id)),
      ...sentiment
    ]),
    funds: Object.freeze([
      ...funds.filter((row) => row.id === 'etf-btc'),
      ...funds.filter((row) => row.id === 'etf-eth'),
      ...funds.filter((row) => row.id === 'stablecoin')
    ]),
    policyPath: document.data.policyPath,
    windowEnd: document.edition.windowEnd,
    editionDate: document.edition.date,
    leverage: document.data.leverage,
    funding: Object.freeze(document.data.funds.filter((row) => row.visibility !== 'hidden' && LEVERAGE_ONLY_FUND_IDS.has(row.id)))
  })
}

/**
 * The whole data region as one ordered list, derived from the groups.
 *
 * Derived, not re-walked: a second traversal of `document.data.*` is how the funding rate came to be
 * printed twice (once in the funds block, once in the leverage card) and how a partition function
 * could sit unused while both renderers kept their own loops.
 */
export function briefingDataRowsFromGroups(groups: BriefingDataGroups): readonly (BriefingMarketRow | BriefingPulseRow)[] {
  return Object.freeze([...groups.price, ...groups.readings, ...groups.funds])
}

/** The same list for a caller that holds the document; both read the one partition. */
export function briefingDataRows(document: DailyBriefingDocument): readonly (BriefingMarketRow | BriefingPulseRow)[] {
  return briefingDataRowsFromGroups(briefingDataGroups(document))
}
