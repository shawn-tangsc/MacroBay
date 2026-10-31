import type { DivergenceDirection, DivergenceLegId, DivergencePairId } from '../../../../contracts/marketDivergence'

export type DivergencePanelText = Readonly<{
  title: string
  /** The word that marks the block as a conclusion rather than another section. */
  helpLabel: string
  helpLines: readonly string[]
  /** Appended when several pairs were held back for the same reason. */
  withheldGroup: string
  retry: string
  /** When we cannot even name a reading, say why in one short sentence. */
  unavailableWhy: Readonly<Record<'all-legs-missing' | 'query-failed' | 'invalid-clock' | 'too-large' | 'bad-payload' | 'bad-answer', string>>
  /** Every pair withheld: nothing was compared, which is not the same as no divergence. */
  nothingCompared: string
  /** "Missing: {legs}" — the legs that made the whole card unavailable. */
  missingLegs: string
  loading: string
  /** No pair diverged: a state, not a failure. */
  empty: string
  unavailable: string
  withheldTitle: string
  withheldReasons: Readonly<Record<'window-mismatch' | 'leg-missing' | 'leg-stale' | 'leg-unavailable', string>>
  /**
   * A sentiment leg that was read and had nothing to score. "{leg}" is the leg's own short name.
   *
   * The generic `leg-missing` line would say "we did not get the reading", which turns a quiet news
   * day into a fault. These are the two facts a reader acts on differently, so they get two lines.
   */
  sentimentNoScoredItems: string
  legs: Readonly<Record<DivergenceLegId, string>>
  directions: Readonly<Record<DivergenceDirection, string>>
  pairs: Readonly<Record<DivergencePairId, Readonly<{ mechanism: string; invalidation: string }>>>
  /** Short name per pair, for lines that must say *which* comparison was skipped. */
  pairNames: Readonly<Record<DivergencePairId, string>>
  /** "{leg} 截至 {at}" — the instant a withheld leg stopped. */
  legAsOf: string
  invalidationLabel: string
}>
