import type { PositioningState } from '../../../../contracts/openInterestPositioning'

export type PositioningPanelText = Readonly<{
  pairTitle: string
  loading: string
  empty: string
  unavailable: string
  observedAt: string
  stale: string
  /** " · {stale}" appended after the observed instant; the separator is punctuation, so it is per language. */
  staleSuffix: string
  missingValue: string
  notional: string
  rateLabel: string
  oiShort: string
  rateShort: string
  settledAt: string
  legendLine: string
  legendBar: string
  assets: Readonly<Record<'btc' | 'eth', string>>
  paymentDirections: Readonly<Record<'long-pays-short' | 'short-pays-long' | 'neutral', string>>
  change1h: string
  change24h: string
  window7d: string
  window24h: string
  states: Readonly<Record<PositioningState, string>>
  stateWhy: string
  liquidationChip: string
  /** The module rule's chip: what it says, and what its own hover line is made of. */
  signalInsufficient: string
  signalHover: string
  signalKindInferred: string
  /** The chip's hover line names the window it judges; the rule reads one closed 15-minute bucket. */
  window15m: string
  /** Opening the chip's numbers: the entry, and every label behind it. Opening costs nothing. */
  signalDetailsOpen: string
  signalDetailsTitle: string
  signalDetailsRule: string
  /** The rule's own words. The internal id never reaches the card. */
  signalDetailsRuleName: string
  signalDetailsWindow: string
  signalDetailsDrop: string
  signalDetailsVolume: string
  signalDetailsObservedAt: string
  signalDetailsNote: string
  helpLabel: string
  /** The popover's four one-look bullets; each one is a point, not a paragraph. */
  helpBullets: readonly string[]
  /** The entry beside the title that opens the longer notes below the card. */
  helpDetailsLabel: string
  helpDetails: readonly string[]
  noRate: string
}>
