import { Tooltip } from '@platform/ui/components/tooltip'

import type { MacroMarketLiveState, MacroMarketLiveTick } from '../../../../contracts/macro/macroMarketSnapshotContracts'
import { useProductTextKey } from '../../../shared/i18n/productTextKey'

/**
 * 提示的键：句子仍住在本面板的 `productText` 里，平台 `Tooltip` 只收键与**已格式化**的观测时间。
 *
 * 时间不走「句子 + 空格 + 时间」的拼接：模板里的 `{time}` 由文案本身负责语序，翻译才改得动它。
 */
const LIVE_HINT_KEY = 'pages.intelligence.portal.dashboard.crossAsset.liveHint'

type Text = { liveStateLabels: Record<MacroMarketLiveState, string> }

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
  const resolveText = useProductTextKey()
  const observed = formatTime(new Date(tick.atMs).toISOString(), 'second')
  // 悬停说明挂在可聚焦的气泡上：焦点进来同一句话也出现，读屏与键盘拿到的与鼠标一致。
  return <Tooltip labelKey={LIVE_HINT_KEY} labelParams={{ time: observed }} resolveText={resolveText}>
    <em className="mi-cross-asset__live" data-live-state={state} data-live-observed={tick.atMs} tabIndex={0}>
      {text.liveStateLabels[state]}
    </em>
  </Tooltip>
}
