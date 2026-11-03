import { Input, Modal, Select } from 'antd'
import { useEffect, useState } from 'react'

import type { PlatformText } from '../../../i18n/platformText'

import type { Agent, Channel } from './channelSettingsPresentation'

/**
 * 名称 + 接消息的助手的弹层（原型 B 的前两个字段）。
 *
 * 同一份弹层负责「新建」与「编辑」：两者的必填项完全一样，分成两份只会让校验规则各写一遍。
 * 弹层自己不发请求：保存由页面调 IPC，成功后页面关掉它——「关闭」因此只有一个原因。
 */
export function ChannelEditDialog(props: {
  channel: Channel
  agents: readonly Agent[]
  labels: PlatformText['settings']
  saving: boolean
  onCancel: () => void
  onSave: (input: { name: string; agentId: string }) => void
}): React.ReactElement {
  const { labels, channel } = props
  const [name, setName] = useState(channel.name)
  const [agentId, setAgentId] = useState(channel.agentId)

  useEffect(() => {
    setName(channel.name)
    setAgentId(channel.agentId)
  }, [channel.id, channel.name, channel.agentId])

  return (
    <Modal
      cancelText={labels.channelCancel}
      okButtonProps={{ disabled: name.trim().length === 0 || agentId.length === 0, loading: props.saving }}
      okText={labels.channelUpdate}
      onCancel={props.onCancel}
      onOk={() => props.onSave({ name: name.trim(), agentId })}
      open
      title={labels.channelEdit}
    >
      <Input
        aria-label={labels.channelName}
        autoFocus
        onChange={(event) => setName(event.target.value)}
        placeholder={labels.channelName}
        value={name}
      />
      <Select
        aria-label={labels.channelAgentId}
        onChange={setAgentId}
        options={props.agents.map((agent) => ({ value: agent.id, label: agent.name }))}
        placeholder={labels.channelAgentId}
        style={{ marginTop: 10, width: '100%' }}
        value={agentId.length === 0 ? undefined : agentId}
      />
    </Modal>
  )
}
