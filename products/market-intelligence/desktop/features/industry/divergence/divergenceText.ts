import type { DivergenceLegId, DivergencePairId } from '../../../../contracts/marketDivergence'

export type DivergencePanelText = Readonly<{
  title: string
  /** 卡面那一行摘要（五态逐字，界面设计 v2）。卡面只剩它，读数进展开区。 */
  summary: Readonly<{
    divergence: string
    quiet: string
    divergenceWithheldOne: string
    divergenceWithheldMany: string
    quietWithheldOne: string
    quietWithheldMany: string
    allWithheld: string
  }>
  /** 展开区标题（「本次读数」）：ⓘ 紧跟其后，卡面因此没有第二个控件。 */
  detailTitle: string
  /** 观察态的中性标签：消息偏空、价格没动。方向色只给 bearish / bullish。 */
  observedLabel: string
  /** 「截至」那一行用的短名：不带窗口，窗口在腿行里已经有了。 */
  legNames: Readonly<Record<DivergenceLegId, string>>
  /** 「当前值 / 规则」那一行：三种写法，只在一处拼（`boundLine`）。 */
  boundAtLeast: string
  boundAtMostNegative: string
  boundAtMostAbsolute: string
  /** 收进 ⓘ 的四句：这张卡怎么来的。 */
  notes: readonly string[]
  /**
   * The rule's chip. Only the intraday pair gets one, and it carries no numbers: the readings stay
   * on the rows below, once.
   */
  chip: string
  /** The hover line: rule, windows, and whether the mark is an inference or an observation. */
  chipTip: string
  /** The word appended to the chip's accessible name, e.g. "看数据". */
  chipDetailsOpen: string
  chipDetailsTitle: string
  /** Chip detail: one group per leg, each reading how fresh it is and when it was taken. */
  chipFreshLabel: string
  chipFresh: string
  chipAsOf: string
  chipWhyLabel: string
  chipWhy: string
  /** The word that marks the block as a conclusion rather than another section. */
  helpLabel: string
  /** Appended when several pairs were held back for the same reason. */
  withheldGroup: string
  /** What separates two withheld pairs, and what marks a missing instant. Per language. */
  withheldListSep: string
  labelSep: string
  missingValue: string
  /** When we cannot even name a reading, say why in one short sentence. */
  /**
   * The one line a failed read leaves behind.
   *
   * The card no longer draws a block for it — the reader asked for that — but hiding a read WE
   * failed to make would let "we could not look" pass for "there is nothing", which is the mistake
   * this product keeps removing. One assertable line, no numbers, no block.
   */
  unavailableTrace: string
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
  directions: Readonly<Record<'bearish' | 'bullish', string>>
  pairs: Readonly<Record<DivergencePairId, Readonly<{ mechanism?: string; invalidation: string }>>>
  /** Short name per pair, for lines that must say *which* comparison was skipped. */
  pairNames: Readonly<Record<DivergencePairId, string>>
  /** "{leg} 截至 {at}" — the instant a withheld leg stopped. */
  legAsOf: string
  invalidationLabel: string
}>
