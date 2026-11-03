import { Button } from 'antd'

import { StatusPill } from '@platform/ui/components/status-pill'
import { formatShellCompactInstant } from '@platform/ui/time/shellTimeFormat'
import { navigateTo } from '@platform/workspace/navigation/navigationRequest'

import type { ChannelRowState } from './channelRow'
import type { NotificationSettingsText } from './notificationSettingsText'

/**
 * 「发送到频道」行（规范 §2 表格第 5 行 + §2.1 的四态）。
 *
 * 这一行**没有开关**：推送哪些事件由下方清单的「频道」列决定，行开关 + 逐条勾选会让
 * 「关了行开关、清单里的勾还亮着但已失效」出现。所以这里只有四样东西——选择器、目标（只读）、
 * 状态行、一个动作。
 *
 * 形态判断全在 `channelRow.ts`；这个文件只负责把每种形态画对，尤其是两种**不许画成对方**的形态：
 * - 「没有可用频道」不画选择器（空下拉把「没有」说成「挑一个」），只给原因与「去接入」；
 * - 「有频道但还没选」不画成「未接入」——那是「推送关着」，不是「没有频道」。
 */
export function ChannelDeliveryRow(props: {
  text: NotificationSettingsText
  state: ChannelRowState
  timeZone: string
  onSelectChannel: (channelId: string) => void
}): React.ReactElement {
  const { text, state } = props

  /** 频道页是唯一能改频道、绑目标的地方：这一行只把人送过去，不在这里改配置。 */
  const openChannels = (): void => navigateTo({ page: 'settings', panel: 'channels' })

  return (
    <div className="notification-row" data-row="channel">
      <span className="notification-row-copy">
        <strong>{text.channelRow}</strong>
        <span className="notification-row-desc">{text.channelDesc}</span>
        <ChannelStatusLine text={text} state={state} timeZone={props.timeZone} />
      </span>
      <span className="notification-row-control">
        <ChannelControls
          text={text}
          state={state}
          onSelectChannel={props.onSelectChannel}
          onOpenChannels={openChannels}
        />
      </span>
    </div>
  )
}

function ChannelStatusLine(props: {
  text: NotificationSettingsText
  state: ChannelRowState
  timeZone: string
}): React.ReactElement | null {
  const { text, state } = props

  if (state.kind === 'not-wired') {
    return (
      <>
        <span className="notification-row-state-row" role="note" data-channel-state>
          <StatusPill tone="warn" labelKey="notificationSettings.channelNotWiredPill" resolveText={pillResolver(text)} />
          <span>{text.channelNone}</span>
        </span>
        <span className="notification-row-hint" role="note">
          {text.channelNeedsEvidence}
        </span>
      </>
    )
  }

  if (state.kind === 'failed') {
    // 时刻由统一格式化产出（带时区），这里只放进模板，不自己拼、不自己 slice。
    const at = formatShellCompactInstant(state.failedAt, { timeZone: props.timeZone })
    // `unknown-after-send`：交出去了、没拿到回执。**不能套「没发出去」那句**——那句话自己会和
    // 「已交给频道」打架，而手机很可能真的收到了。只出中性句，不给「失败」药丸：
    // 药丸是状态结论，这里既不是成功也不是失败。
    if (state.failedReason === 'unknown-after-send') {
      // 药丸用 `muted`「不确定」：这一档既不是失败也不是成功，不能借「推送失败」那档。
      return (
        <span className="notification-row-state-row" role="note" data-channel-state data-push-unknown>
          <StatusPill
            tone="muted"
            labelKey="notificationSettings.channelPushUnconfirmedPill"
            resolveText={pillResolver(text)}
          />
          <span>{text.channelPushUnknown(at)}</span>
        </span>
      )
    }
    // 其余原因码是闭集：查得到翻译，查不到就如实说「这次没留下原因」，绝不把码或原始错误印给读者。
    const reason =
      state.failedReason === null
        ? text.pushFailureReasonUnknown
        : text.pushFailureReason[state.failedReason] ?? text.pushFailureReasonUnknown
    return (
      <span className="notification-row-state-row" role="note" data-channel-state>
        <StatusPill tone="bad" labelKey="notificationSettings.channelPushFailedPill" resolveText={pillResolver(text)} />
        <span>{text.channelPushFailed(reason, at)}</span>
      </span>
    )
  }

  // 可用且没有失败：成功不打标，这里一行都不写。
  if (state.kind === 'ready') return null

  const sentence =
    state.kind === 'unselected'
      ? text.channelUnselected
      : state.kind === 'unbound'
        ? text.channelUnbound
        : text.channelAmbiguous
  return (
    <span className="notification-row-state" role="note" data-channel-state>
      {sentence}
    </span>
  )
}

function ChannelControls(props: {
  text: NotificationSettingsText
  state: ChannelRowState
  onSelectChannel: (channelId: string) => void
  onOpenChannels: () => void
}): React.ReactElement {
  const { text, state } = props

  // 「没有可用频道」：不出现选择器，只留一个动作。
  if (state.kind === 'not-wired') {
    return (
      <Button size="small" onClick={props.onOpenChannels}>
        {text.goConnect}
      </Button>
    )
  }

  const selectedId = state.kind === 'unselected' ? '' : state.selectedId
  return (
    <>
      <select
        className="notification-channel-select"
        aria-label={text.channelRow}
        value={selectedId}
        onChange={(event) => props.onSelectChannel(event.currentTarget.value)}
      >
        {/* 没选时的那一项只是位置，不给它「未接入」的语义：频道是有的，只是还没选。 */}
        {state.kind === 'unselected' ? (
          <option value="" disabled>
            {text.channelChoosePlaceholder}
          </option>
        ) : null}
        {state.choices.map((choice) => (
          <option key={choice.id} value={choice.id}>
            {choice.name}
          </option>
        ))}
      </select>

      {state.kind === 'ready' || state.kind === 'failed' ? (
        <span className="notification-channel-target" data-channel-target={state.target}>
          <span>{text.channelTargetLabel}</span>
          <b>{targetLabel(state.target, text)}</b>
        </span>
      ) : null}

      {/* 未绑定、多会话、失败：三种都要人回频道页处理，动作是同一个。 */}
      {state.kind === 'unbound' || state.kind === 'ambiguous' || state.kind === 'failed' ? (
        <Button size="small" onClick={props.onOpenChannels}>
          {text.goCheck}
        </Button>
      ) : null}
    </>
  )
}

function targetLabel(target: 'direct' | 'group' | 'channel', text: NotificationSettingsText): string {
  if (target === 'direct') return text.channelTargetDirect
  if (target === 'group') return text.channelTargetGroup
  return text.channelTargetChannel
}

/** 药丸只收键：解析不到就说「读不出来」，绝不把键名印到屏幕上。 */
function pillResolver(text: NotificationSettingsText): (key: string) => string {
  return (key) => {
    if (key === 'notificationSettings.channelNotWiredPill') return text.pillNotWired
    if (key === 'notificationSettings.channelPushFailedPill') return text.pillPushFailed
    if (key === 'notificationSettings.channelPushUnconfirmedPill') return text.pillPushUnconfirmed
    return text.pillUnavailable
  }
}
