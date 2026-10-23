import type { MacroMarketLiveState, MacroMarketLiveTick } from '../../../../contracts/macro/macroMarketSnapshotContracts'

type Text = { liveStateLabels: Record<MacroMarketLiveState, string>; liveHint: string }

/**
 * The 最新 cell's live badge. It exists to make one distinction unmissable: the figure beside it is
 * an unclosed stream tick, while the four window cells come from closed bars. A badge is only ever
 * rendered when a tick exists — no tick, no badge, and never a figure standing in for one.
 */
export function LiveBadge({ state, tick, formatTime, text }: {
  state: MacroMarketLiveState
  tick: MacroMarketLiveTick
  formatTime: (value: string, precision: 'second') => string
  text: Text
}): React.ReactElement {
  const observed = formatTime(new Date(tick.atMs).toISOString(), 'second')
  return <em className="mi-cross-asset__live" data-live-state={state} data-live-observed={tick.atMs}
    title={`${text.liveHint} ${observed}`}>{text.liveStateLabels[state]}</em>
}
