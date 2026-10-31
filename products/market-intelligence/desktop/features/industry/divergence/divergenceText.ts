import type { DivergenceDirection, DivergenceLegId, DivergencePairId } from '../../../../contracts/marketDivergence'

export type DivergencePanelText = Readonly<{
  title: string
  /** The word that marks the block as a conclusion rather than another section. */
  kicker: string
  /** One line stating what decided this card, so it is not read as the model's conclusion. */
  basis: string
  loading: string
  /** No pair diverged: a state, not a failure. */
  empty: string
  unavailable: string
  withheldTitle: string
  withheldReasons: Readonly<Record<'window-mismatch' | 'leg-missing' | 'leg-stale', string>>
  legs: Readonly<Record<DivergenceLegId, string>>
  directions: Readonly<Record<DivergenceDirection, string>>
  pairs: Readonly<Record<DivergencePairId, Readonly<{ mechanism: string; invalidation: string }>>>
  /** "{leg} 截至 {at}" — the instant a withheld leg stopped. */
  legAsOf: string
  invalidationLabel: string
}>
