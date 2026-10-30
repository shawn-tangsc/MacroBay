import type { PositioningState } from '../../../../contracts/openInterestPositioning'

export type PositioningPanelText = Readonly<{
  pairTitle: string
  loading: string
  empty: string
  unavailable: string
  observedAt: string
  stale: string
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
  liquidationMore: string
  liquidationChip: string
  helpLabel: string
  helpLines: readonly string[]
  liquidationUnavailable: string
  noRate: string
}>
