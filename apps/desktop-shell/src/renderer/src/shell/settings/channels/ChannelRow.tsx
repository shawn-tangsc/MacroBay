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
}): React.ReactElement {
  const { channel, labels } = props
  const resolveText = (key: string): string => {
    if (key === 'channelLogs') return labels.channelLogs
    if (key === 'channelEdit') return labels.channelEdit
    if (key === 'channelDelete') return labels.channelDelete
    return labels.channelEnableSwitch
  }
  // 凭据取不到是「这条频道现在不能用」，红点 + 行内原因；其余状态只用点色区分，不写句子。
  const failure = channel.credential.status === 'unavailable' ? labels.channelCredentialUnavailable : null
  const dot = failure !== null ? 'bad' : channel.state === 'runtime-ready' ? 'ok' : 'muted'

  return (
    <div className="channel-row" data-channel-id={channel.id} data-channel-state={channel.state}>
      <span className={`channel-row-dot channel-row-dot--${dot}`} aria-hidden="true" />
      <span className="channel-row-name">{channel.name}</span>
      <span className="channel-row-mask" aria-label={labels.channelCredential}>
        {labels.channelTokenMask}
      </span>
      {failure === null ? null : (
        <span className="channel-row-error" role="note">
          {failure}
        </span>
      )}
      <span className="channel-row-actions">
        <IconButton
          ariaLabelKey="channelLogs"
          icon={FileText}
          onSelect={() => props.onLogs(channel)}
          resolveText={resolveText}
          size="sm"
        />
        <IconButton
          ariaLabelKey="channelEdit"
          icon={Pencil}
          onSelect={() => props.onEdit(channel)}
          resolveText={resolveText}
          size="sm"
        />
        <IconButton
          ariaLabelKey="channelDelete"
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
