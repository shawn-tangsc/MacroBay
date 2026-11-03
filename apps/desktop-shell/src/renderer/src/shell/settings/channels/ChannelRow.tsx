import { Switch } from 'antd'
import { FileText, Pencil, Trash2 } from 'lucide-react'

import { IconButton } from '@platform/ui/components/icon-button'
import type { PlatformText } from '../../../i18n/platformText'

import type { Channel } from './channelSettingsPresentation'

/**
 * 频道列表的一行：**状态点 + 名称 + 掩码 Token + 右侧四个动作**（原型 A）。
 *
 * 几条写进形状里的约定：
 * - Token 永远是整串星号：这一行不提供查看、也不提供复制。要露头尾就得让主进程解出明文再切片段，
 *   那等于给「部分可看」开一个口子，用户已经否了。
 * - 出错的行走**红点 + 行内一句话**，不弹面板、不弹原始错误串——错误是这一行的属性，不是一次弹窗。
 * - 行本身不可点：四个动作各自是一个控件，点空白不会连带做别的事。
 */
export function ChannelRow(props: {
  channel: Channel
  labels: PlatformText['settings']
  busy: boolean
  onToggle: (channel: Channel, next: boolean) => void
  onEdit: (channel: Channel) => void
  onDelete: (channel: Channel) => void
  onLogs: (channel: Channel) => void
  /** 现场检查没过的原因：就地一行，开关已回弹。 */
  enableFailure?: string | null
}): React.ReactElement {
  const { channel, labels } = props
  // 读屏名收的是**键**（点分路径）。键 → 句子只有这一张表，没有第二套 if 链；
  // 查不到就返回空串：没键要立刻暴露，不能让一个不相干的兜底句替它发言（上一版三个按钮
  // 因此全念成「启用这个频道」）。
  const rowActionText: Readonly<Record<string, string>> = {
    'settings.channels.logs': labels.channelLogs,
    'settings.channels.edit': labels.channelEdit,
    'settings.channels.delete': labels.channelDelete
  }
  const resolveText = (key: string): string => rowActionText[key] ?? ''
  // 凭据读不出来 = 这条频道现在不能用：点变红，完整说法写在掩码那一位（同一件事只说一遍）。
  const dot =
    channel.credential.status === 'unavailable'
      ? 'bad'
      : channel.state === 'runtime-ready'
        ? 'ok'
        : 'muted'

  return (
    <div className="channel-row" data-channel-id={channel.id} data-channel-state={channel.state}>
      <span className={`channel-row-dot channel-row-dot--${dot}`} aria-hidden="true" />
      <span className="channel-row-name">{channel.name}</span>
      <span className="channel-row-mask" aria-label={labels.channelCredential}>
        {/* 三档必须三句话，别把「从来没存」和「存过但读不出来」说成一句：
            - configured：显示主进程算好的头尾掩码（渲染层不切值）；
            - unavailable：**存过**，只是读不出来——写这一句，绝不画星号也不会写「还没有 Token」；
            - missing：真没有，说「还没有 Token」（画星号会被读成「有值但看不见」）。 */}
        {channel.credential.status === 'configured'
          ? (channel.credential.maskedFields?.bot_token ?? labels.channelTokenMask)
          : channel.credential.status === 'unavailable'
            ? labels.channelTokenUnavailable
            : labels.channelTokenNone}
      </span>
      {props.enableFailure === null || props.enableFailure === undefined ? null : (
        <span className="channel-row-error" data-enable-failure role="note">
          {props.enableFailure}
        </span>
      )}
      <span className="channel-row-actions">
        <IconButton
          ariaLabelKey="settings.channels.logs"
          icon={FileText}
          onSelect={() => props.onLogs(channel)}
          resolveText={resolveText}
          size="sm"
        />
        <IconButton
          ariaLabelKey="settings.channels.edit"
          icon={Pencil}
          onSelect={() => props.onEdit(channel)}
          resolveText={resolveText}
          size="sm"
        />
        <IconButton
          ariaLabelKey="settings.channels.delete"
          icon={Trash2}
          onSelect={() => props.onDelete(channel)}
          resolveText={resolveText}
          size="sm"
        />
        <Switch
          aria-label={labels.channelEnableSwitch}
          checked={channel.state === 'runtime-ready'}
          disabled={props.busy || channel.state === 'deleting'}
          loading={props.busy}
          onChange={(next) => props.onToggle(channel, next)}
          size="small"
        />
      </span>
    </div>
  )
}
