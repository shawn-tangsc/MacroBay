import { Button } from 'antd'

import { DisabledHint } from '@platform/ui/components/disabled-hint'
import { LoadingSpinner } from '@platform/ui/components/loading'

import type { BriefingPushText } from './dailyBriefingPushText'
import type { BriefingPushState } from './dailyBriefingPushWiring'

/**
 * 频道发布按钮（文案在 `briefingPushText`，改词只动表）：只负责长什么样、什么时候不能按、
 * 失败了说什么。
 *
 * 它**不发请求**——`onPush` / `onRetry` 由页面接（状态机在 `dailyBriefingPushWiring` 里），所以这个
 * 文件里一条 IPC/传输 import 都没有。「页面接线归简报线」不靠自觉，靠这里没有东西可调。
 *
 * 三条写进结构、不靠评审：
 * - **禁用必须说理由**：原因用 `DisabledHint` 挂成 `aria-describedby`——禁用的按钮接不到 hover 也接不到
 *   焦点，`title` 那条路是死的；四种处境四句话，不合并成「暂不可用」。
 * - **失败要具名且可重试**：原因由状态机给（不是组件归一），失败行留在按钮旁不随 toast 消失——读者
 *   要看清错在哪，再决定重不重试。
 * - **成功不在这里报**：「已交给 {channel}（未拿到回执）」需要通道名与回执状态，那是页面的 toast。
 *
 * 文案来自 `briefingPushText`（每个词一个键），组件内不拼句子、不出现通道名。
 */
export type BriefingPushToPhoneButtonProps = Readonly<{
  state: BriefingPushState
  text: BriefingPushText
  onPush: () => void
  onRetry: () => void
}>

export function BriefingPushToPhoneButton({ state, text, onPush, onRetry }: BriefingPushToPhoneButtonProps): React.ReactElement {
  const sending = state.kind === 'sending'
  const blocked = state.kind === 'disabled' ? state.reason : undefined
  const failed = state.kind === 'failed' ? state.reason : undefined

  // The platform's own button and its own spinner: no colour, no size, no rotation of our own — the
  // waiting state is the same one every other control in the app shows.
  const button = <Button
    disabled={sending || blocked !== undefined}
    icon={sending ? <LoadingSpinner size="sm" /> : undefined}
    onClick={failed === undefined ? onPush : onRetry}
    className="mi-briefing-tool__btn">
    {sending ? text.sending : text.button}
  </Button>

  return <span className="mi-daily-briefing__push">
    {blocked === undefined
      ? button
      : <DisabledHint labelKey={`dailyBriefing.push.blocked.${blocked}`} resolveText={(key: string) => (key === `dailyBriefing.push.blocked.${blocked}` ? text.disabled[blocked] : '')}>{button}</DisabledHint>}
    {failed === undefined
      ? null
      : <span className="mi-daily-briefing__push-failure" role="status">
        <span>{text.failedTitle}：{text.failed[failed]}</span>
        <Button onClick={onRetry} size="small" type="link">{text.retry}</Button>
      </span>}
  </span>
}
