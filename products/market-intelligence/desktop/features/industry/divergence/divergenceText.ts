import type { DivergenceDirection, DivergenceLegId, DivergencePairId } from '../../../../contracts/marketDivergence'

export type DivergencePanelText = Readonly<{
  title: string
  /** The word that marks the block as a conclusion rather than another section. */
  /** Who judged, shown as a small badge: the model, or the threshold table when it could not answer. */
  judgedBy: Readonly<Record<'ai' | 'rules', string>>
  helpLabel: string
  helpLines: readonly string[]
  /** Appended when several pairs were held back for the same reason. */
  withheldGroup: string
  /** The manual trigger, offered only when the rules found nothing to explain. */
  judgeAgain: string
  loading: string
  /** No pair diverged: a state, not a failure. */
  empty: string
  unavailable: string
  withheldTitle: string
  withheldReasons: Readonly<Record<'window-mismatch' | 'leg-missing' | 'leg-stale', string>>
  legs: Readonly<Record<DivergenceLegId, string>>
  directions: Readonly<Record<DivergenceDirection, string>>
  pairs: Readonly<Record<DivergencePairId, Readonly<{ mechanism: string; invalidation: string }>>>
  /** Short name per pair, for lines that must say *which* comparison was skipped. */
  pairNames: Readonly<Record<DivergencePairId, string>>
  /** "{leg} 截至 {at}" — the instant a withheld leg stopped. */
  legAsOf: string
  invalidationLabel: string
}>
