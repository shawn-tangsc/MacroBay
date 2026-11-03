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
  saving: boolean
  onCancel: () => void
  onSave: (input: {
    name: string
    agentId: string
    workspaceId: string | null
    permissionMode: ChannelFieldValues['permissionMode']
    allowedChatIds: readonly string[]
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
                allowedChatIds: parseAllowedChatIds(values.allowedChatIdsText)
              })
            }
            type="primary">
            {labels.channelUpdate}
          </Button>
        </>
      }
    >
      <ChannelFields
        agents={props.agents}
        labels={labels}
        mode="edit"
        policyPresence={props.policyPresence}
        onChange={(patch) => setValues((previous) => ({ ...previous, ...patch }))}
        values={values}
      />
    </Modal>
  )
}
