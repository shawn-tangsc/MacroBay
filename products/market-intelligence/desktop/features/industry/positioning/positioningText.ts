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
  /** 按方向分叉的牌子：“强平”分不出多头还是空头，读者会做反动作。 */
  liquidationChipLong: string
  liquidationChipShort: string
  /**
   * 强平判定的三种说法，卡面脚注区一行，互斥、同位置只出现一句。
   * 三句都不许用警告色：它们说的是判定的结论，不是「我们出错了」的警报。
   */
  liquidationNoteNoHit: string
  liquidationNoteUnreadable: string
  liquidationNoteInsufficient: string
  /**
   * 图上画不下、只报个数的那一行；只在真的截断时出现。
   *
   * 用「爆仓」不用「强平」：这张卡里「强平」是规则名（「强平判定…没有命中」），而牌子写的是
   * 「疑似多头爆仓」——同一件事必须同一个名字。保留「疑似」：它只是计数，不该比牌子更肯定。
   */
  liquidationHiddenHits: string
  /** 图上的标记牌：一条写方向 + 价格变化；同向成簇写 ×N；混向不写方向。 */
  markLong: string
  markShort: string
  markLongMany: string
  markShortMany: string
  markMixedMany: string
  /** The module rule's chip: what it says, and what its own hover line is made of. */
  signalHover: string
  signalKindInferred: string
  /** The chip's hover line names the window it judges; the rule reads one closed 15-minute bucket. */
  window15m: string
  /** The dialog behind the chip: every label in it. Opening costs nothing. */
  signalDetailsTitle: string
  signalDetailsRule: string
  /** The rule's own words. The internal id never reaches the card. */
  signalDetailsRuleName: string
  signalDetailsWindow: string
  signalDetailsDrop: string
  signalDetailsVolume: string
  signalDetailsObservedAt: string
  signalDetailsNote: string
  /** The popover's four one-look bullets; each one is a point, not a paragraph. */
  helpBullets: readonly string[]
  /** The entry beside the title that opens the longer notes below the card. */
  helpDetailsLabel: string
  helpDetails: readonly string[]
  noRate: string
}>
