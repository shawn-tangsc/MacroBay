import { Button, Switch } from 'antd'

import { StatusPill, type StatusPillTone } from '@platform/ui/components/status-pill'

import type { NotificationSettingsText } from './notificationSettingsText'
import type { PushChannelOption } from './pushChannels'

/**
 * 五个本机落点 + 一条出站通道，一行一个控件（规范 §2）。
 *
 * 这一块的硬规矩：**一件事只有一个控件**。曾经这里是「行开关 + 逐条勾选」两套，
 * 于是取消订阅后行开关还亮着、清单里那个勾也还亮着，读者无法判断哪个算数。
 */
export type ChannelRowState =
  | { kind: 'none' }
  | { kind: 'unbound'; channelName: string }
  | { kind: 'multiple'; channelName: string }
  | { kind: 'failed'; channelName: string; target: string; reason: string; at: string }
  | { kind: 'ok'; channelName: string; target: string }

/**
 * 通道行该显示哪一态。**判序固定**：没有可用通道 → 未绑定 → 绑了多个 → 最近一次失败 → 正常。
 * 顺序反了会出现「有通道却写着没有」这类自相矛盾的屏。
 */
export function channelRowState(input: {
  channelId: string | null
  channels: readonly PushChannelOption[]
  lastPushFailureAt: string | null
  lastPushFailureReason: string | null
  formatInstant: (iso: string) => string
}): ChannelRowState {
  if (input.channels.length === 0) return { kind: 'none' }
  const selected = input.channels.find((channel) => channel.id === input.channelId) ?? input.channels[0]!
  if (selected.target === null && selected.targetCount === 0) return { kind: 'unbound', channelName: selected.name }
  if (selected.targetCount > 1) return { kind: 'multiple', channelName: selected.name }
  if (input.lastPushFailureAt !== null) {
    return {
      kind: 'failed',
      channelName: selected.name,
      target: selected.target ?? '',
      reason: input.lastPushFailureReason ?? '',
      at: input.formatInstant(input.lastPushFailureAt)
    }
  }
  return { kind: 'ok', channelName: selected.name, target: selected.target ?? '' }
}

const PERMISSION_TONE: Record<'granted' | 'denied' | 'unknown', StatusPillTone> = {
  granted: 'ok',
  denied: 'bad',
  unknown: 'muted'
}

export function DeliveryRows(props: {
  text: NotificationSettingsText
  toastEnabled: boolean
  onToastChange: (next: boolean) => void
  desktopPermission: 'granted' | 'denied' | 'unknown' | null
  onOpenSystemSettings?: () => void
  channel: ChannelRowState
  channels: readonly PushChannelOption[]
  channelId: string | null
  onSelectChannel: (id: string) => void
  onOpenChannelPage?: () => void
}): React.ReactElement {
  const { text, desktopPermission } = props

  return (
    <div className="notification-rows">
      {/* 通知中心：无控件，右侧一个标签。标签不是禁用开关——禁用开关会让人以为以后能开。 */}
      <div className="notification-row" data-row="center">
        <span className="notification-row-copy">
          <strong>{text.centerRow}</strong>
          <span className="notification-row-desc">{text.centerDesc}</span>
        </span>
        <span className="notification-row-control">
          <span className="notification-subs-fixed">{text.centerFixed}</span>
        </span>
      </div>

      {/* 应用内提示：全站一个开关，不是总闸。 */}
      <div className="notification-row" data-row="toast">
        <span className="notification-row-copy">
          <strong>{text.toastRow}</strong>
          <span className="notification-row-desc">{text.toastDesc}</span>
        </span>
        <span className="notification-row-control">
          <Switch size="small" checked={props.toastEnabled} onChange={(next) => props.onToastChange(next)} />
        </span>
      </div>

      {/* 桌面通知：没有开关。开关是清单里的桌面列，这一行只说系统放没放行。 */}
      <div className="notification-row" data-row="desktop" data-permission={desktopPermission ?? 'unknown'}>
        <span className="notification-row-copy">
          <strong>{text.desktopRow}</strong>
          <span className="notification-row-desc">{text.desktopDesc}</span>
          {desktopPermission === 'denied' ? (
            <span className="notification-row-hint" role="note">
              {text.desktopKeepChoice}
            </span>
          ) : null}
        </span>
        <span className="notification-row-control">
          {desktopPermission === null ? null : (
            <StatusPill
              tone={PERMISSION_TONE[desktopPermission]}
              labelKey={
                desktopPermission === 'granted'
                  ? text.desktopPermissionGranted
                  : desktopPermission === 'denied'
                    ? text.desktopPermissionDenied
                    : text.desktopPermissionUnknown
              }
              resolveText={(key) => key}
            />
          )}
          {desktopPermission === 'denied' && props.onOpenSystemSettings !== undefined ? (
            <Button size="small" onClick={props.onOpenSystemSettings}>
              {text.desktopOpenSettings}
            </Button>
          ) : null}
        </span>
      </div>

      {/* 高优先级弹窗：整行禁用 + 常驻原因。原因说「位置先留着」，不说「以后会做」。 */}
      <div className="notification-row notification-row--disabled" data-row="popup" aria-disabled="true">
        <span className="notification-row-copy">
          <strong>{text.popupRow}</strong>
          <span className="notification-row-desc" role="note">
            {text.popupDisabled}
          </span>
        </span>
      </div>

      <ChannelRow {...props} />
    </div>
  )
}

function ChannelRow(props: {
  text: NotificationSettingsText
  channel: ChannelRowState
  channels: readonly PushChannelOption[]
  channelId: string | null
  onSelectChannel: (id: string) => void
  onOpenChannelPage?: () => void
}): React.ReactElement {
  const { text, channel } = props
  // 没有可用通道时**不出现选择器**：空下拉会让人以为列表没加载出来。
  const showSelector = channel.kind !== 'none' && props.channels.length > 0

  return (
    <div className="notification-row notification-channel-row" data-row="channel" data-channel-state={channel.kind}>
      <span className="notification-row-copy">
        <strong>{text.channelRow}</strong>
        <span className="notification-row-desc">{text.channelDesc}</span>
        {channel.kind === 'none' ? (
          <>
            <span className="notification-row-state" role="note">
              {text.channelNone}
            </span>
            <span className="notification-row-hint">{text.channelNoEvidence}</span>
          </>
        ) : null}
        {channel.kind === 'unbound' ? <span className="notification-row-state">{text.channelTargetUnbound}</span> : null}
        {channel.kind === 'multiple' ? <span className="notification-row-state">{text.channelTargetMultiple}</span> : null}
        {channel.kind === 'failed' ? (
          // 失败行：**结论**由 `StatusPill` 说（红只落在圆点与边框），**句子**用中性文字。
          // 原来把 `--danger` 加在整句上，深色底对比度只有 3.25–3.94，句子读不清；
          // 时刻仍由调用方用 `formatShellCompactInstant` 产出，这里只放进句子，不自己拼。
          <span className="notification-row-state-row">
            <StatusPill
              tone="bad"
              labelKey="notificationSettings.channelPushFailedPill"
              resolveText={(key) => (key === 'notificationSettings.channelPushFailedPill' ? text.channelPushFailedPill : key)}
            />
            <span className="notification-row-state" role="note">
              {text.channelLastPushFailed(channel.reason, channel.at)}
            </span>
          </span>
        ) : null}
        {channel.kind === 'ok' ? (
          // 目标只读：让读者知道会发到哪儿；**成功不打标**，所以只有这一行文字。
          <span className="notification-row-hint">{channel.target}</span>
        ) : null}
      </span>
      <span className="notification-row-control">
        {showSelector ? (
          <select
            className="notification-channel-select"
            aria-label={text.channelSelectLabel}
            value={props.channelId ?? ''}
            onChange={(event) => props.onSelectChannel(event.currentTarget.value)}
          >
            {props.channels.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        ) : null}
        {channel.kind === 'none' && props.onOpenChannelPage !== undefined ? (
          <Button size="small" onClick={props.onOpenChannelPage}>
            {text.channelGoConnect}
          </Button>
        ) : null}
        {(channel.kind === 'unbound' || channel.kind === 'multiple' || channel.kind === 'failed') &&
        props.onOpenChannelPage !== undefined ? (
          <Button size="small" onClick={props.onOpenChannelPage}>
            {text.channelGoCheck}
          </Button>
        ) : null}
        {channel.kind === 'ok' && channel.target.length > 0 && props.onOpenChannelPage !== undefined ? (
          <Button size="small" onClick={props.onOpenChannelPage}>
            {text.channelGoCheck}
          </Button>
        ) : null}
      </span>
    </div>
  )
}
