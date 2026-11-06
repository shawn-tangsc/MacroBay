import { Button } from 'antd'

import { DisabledHint } from '@platform/ui/components/disabled-hint'
import { LoadingSpinner } from '@platform/ui/components/loading'

import type { BriefingPushText } from './dailyBriefingPushText'
import type { BriefingPushState } from './dailyBriefingPushWiring'

/**
 * 频道发布按钮（文案在 `briefingPushText`，改词只动表）：只负责长什么样、什么时候不能按。
 *
 * 它**不发请求**——`onPush` / `onRetry` 由页面接（状态机在 `dailyBriefingPushWiring` 里），所以这个
 * 文件里一条 IPC/传输 import 都没有。「页面接线归简报线」不靠自觉，靠这里没有东西可调。
 *
 * 三条写进结构、不靠评审：
 * - **禁用必须说理由，但工具栏里不说给眼睛看**：原因仍由 `DisabledHint` 挂成 `aria-describedby`——
 *   禁用的按钮接不到 hover 也接不到焦点，`title` 那条路是死的；四种处境四句话，不合并成「暂不可用」。
 *   位置规则见界面规范 §5.1：动作行/工具栏不常驻原因文字（`reasonDisplay="sr-only"`），读屏与悬停照常。
 * - **失败与回执都走平台 toast**（用户 2026-11-05 定）：工具栏里只留按钮，不再挂一行「没发出去…重试」；
 *   那句字又丑又常驻，读者要的是点一下、看一条提示、几秒后消失。重试就是再点一次按钮。
 * - **成功也不在这里报**：「已交给 {channel}（未拿到回执）」需要通道名与回执状态，那是页面的 toast。
 *
 * 文案来自 `briefingPushText`（每个词一个键），组件内不拼句子、不出现通道名。
 */
export type BriefingPushToPhoneButtonProps = Readonly<{
  state: BriefingPushState
  text: BriefingPushText
  onPush: () => void
}>

export function BriefingPushToPhoneButton({ state, text, onPush }: BriefingPushToPhoneButtonProps): React.ReactElement {
  const sending = state.kind === 'sending'
  const blocked = state.kind === 'disabled' ? state.reason : undefined

  // The platform's own button and its own spinner: no colour, no size, no rotation of our own — the
  // waiting state is the same one every other control in the app shows.
  const button = <Button
    disabled={sending || blocked !== undefined}
    icon={sending ? <LoadingSpinner size="sm" /> : undefined}
    onClick={onPush}
    className="mi-briefing-tool__btn">
    {sending ? text.sending : text.button}
  </Button>

  return <span className="mi-daily-briefing__push">
    {blocked === undefined
      ? button
      : <DisabledHint
        labelKey={`dailyBriefing.push.blocked.${blocked}`}
        // 工具栏是一排按钮，不是说明区（用户 2026-11-05：「把按钮禁用就行了」）。
        reasonDisplay="sr-only"
        resolveText={(key: string) => (key === `dailyBriefing.push.blocked.${blocked}` ? text.disabled[blocked] : '')}
      >{button}</DisabledHint>}
  </span>
}
