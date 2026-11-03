import { Button } from 'antd'

import { Modal } from '@platform/ui/components/modal'
import { useEffect, useState } from 'react'

import type { PlatformText } from '../../../i18n/platformText'

import { ChannelFields, parseAllowedChatIds, type ChannelFieldValues, type ChannelPolicyPresence } from './ChannelFields'
import type { Agent, Channel } from './channelSettingsPresentation'

/**
 * 编辑弹层：与新建**同一套六字段布局**（需求 v7）。
 *
 * 编辑时 Token 只有圆点，没有输入框：改 Token 是另一条路径（换 Token），不在这里顺手可改。
 * 弹层自己不发请求：保存由页面调 IPC，成功后页面关掉它——「关闭」因此只有一个原因。
 */
export function ChannelEditDialog(props: {
  channel: Channel
  agents: readonly Agent[]
  labels: PlatformText['settings']
  /** 这个频道有没有显式放行名单：决定空列表的文案。 */
  policyPresence: ChannelPolicyPresence
  /** 保存没通过时的就地一句话（回读没确认到凭据）。页面级那句在遮罩后面，读者看不见。 */
  saveError?: string | null
  saving: boolean
  onCancel: () => void
  onSave: (input: {
    name: string
    agentId: string
    workspaceId: string | null
    permissionMode: ChannelFieldValues['permissionMode']
    allowedChatIds: readonly string[]
    /** 空串＝保持原 Token；非空＝整串替换。 */
    token: string
  }) => void
}): React.ReactElement {
  const { labels, channel } = props
  const fromChannel = (target: Channel): ChannelFieldValues => ({
    name: target.name,
    agentId: target.agentId,
    token: '',
    workspaceId: target.workspace?.type === 'user' ? target.workspace.workspaceId : null,
    permissionMode: target.permissionMode ?? null,
    allowedChatIdsText: (target.allowedChatIds ?? []).join('\n')
  })
  const [values, setValues] = useState<ChannelFieldValues>(fromChannel(channel))

  useEffect(() => {
    setValues(fromChannel(channel))
  }, [channel.id, channel.name, channel.agentId, channel.workspace, channel.permissionMode])

  return (
    <Modal
      open
      width="standard"
      onClose={props.onCancel}
      titleKey="settings.channels.edit"
      resolveText={(key) => (key === 'settings.channels.edit' ? labels.channelEdit : '')}
      footer={
        <>
          <Button key="cancel" onClick={props.onCancel}>
            {labels.channelCancel}
          </Button>
          <Button
            disabled={values.name.trim().length === 0 || values.agentId.length === 0}
            key="save"
            loading={props.saving}
            onClick={() =>
              props.onSave({
                name: values.name.trim(),
                agentId: values.agentId,
                workspaceId: values.workspaceId,
                permissionMode: values.permissionMode,
                allowedChatIds: parseAllowedChatIds(values.allowedChatIdsText),
                token: values.token
              })
            }
            type="primary">
            {labels.channelUpdate}
          </Button>
        </>
      }
    >
      <p className="channel-edit-current" data-current-token>
        {/* 只显示头尾掩码（主进程算好送来的），不显示「最近更新」：安全视图里没有凭据时间戳，
            拿频道记录的 updated_at 冒充它，就是另一种说假话。改没改成功，看这串变没变。
            **没有凭据时不许写「当前已存：********」**：那句话会让人以为自己早就存过。 */}
        {channel.credential.hasCredential !== false && channel.credential.status !== 'missing'
          ? labels.channelTokenCurrent.replace(
              '{mask}',
              channel.credential.maskedFields?.bot_token ?? labels.channelTokenMask
            )
          : labels.channelTokenCurrentNone}
        {/* 「改没改成功」的第二条凭据：保存次数。不是时间——没有凭据时间戳，写时间就是假话。 */}
        {channel.credential.hasCredential !== false && typeof channel.credential.revision === 'number'
          ? ` · ${labels.channelTokenRevision.replace('{count}', String(channel.credential.revision))}`
          : ''}
      </p>
      {props.saveError ? (
        <p className="channel-inline-error" data-channel-save-error role="alert">
          {props.saveError}
        </p>
      ) : null}
      <ChannelFields
        agents={props.agents}
        labels={labels}
        mode="edit"
        policyPresence={props.policyPresence}
        onChange={(patch) => setValues((previous) => ({ ...previous, ...patch }))}
        tokenStored={channel.credential.hasCredential !== false && channel.credential.status !== 'missing'}
        values={values}
      />
    </Modal>
  )
}
