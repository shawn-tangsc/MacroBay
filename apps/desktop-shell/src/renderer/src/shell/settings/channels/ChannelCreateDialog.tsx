import { Input, Modal, Select } from 'antd'
import { useEffect, useState } from 'react'

import type { PlatformText } from '../../../i18n/platformText'

import type { Agent } from './channelSettingsPresentation'
import { clearSensitiveDraft, encryptChannelHandoff } from './secureCredentialHandoff'

/**
 * 「＋ 添加」的弹层：名称、接消息的助手、Bot Token（原型 B 的前三个字段）。
 *
 * Token 只在这里出现一次，且**只进不出**：提交走平台的凭据交接（WebCrypto 加密后再过 IPC），
 * 成功后立刻清空草稿。列表里它永远只是星号——这一条是安全口径，不是排版偏好。
 */
export function ChannelCreateDialog(props: {
  agents: readonly Agent[]
  labels: PlatformText['settings']
  saving: boolean
  onCancel: () => void
  onCreate: (input: { name: string; agentId: string; token: string }) => void
}): React.ReactElement {
  const { labels } = props
  const [name, setName] = useState('')
  const [agentId, setAgentId] = useState('')
  const [token, setToken] = useState('')

  useEffect(() => () => clearSensitiveDraft(setToken), [])

  return (
    <Modal
      cancelText={labels.channelCancel}
      okButtonProps={{
        disabled: name.trim().length === 0 || agentId.length === 0 || token.trim().length === 0,
        loading: props.saving
      }}
      okText={labels.channelCreate}
      onCancel={props.onCancel}
      onOk={() => props.onCreate({ name: name.trim(), agentId, token })}
      open
      title={labels.channelCreate}
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
      <Input.Password
        aria-label={labels.channelCredential}
        autoComplete="off"
        onChange={(event) => setToken(event.target.value)}
        placeholder={labels.channelCredential}
        style={{ marginTop: 10 }}
        value={token}
      />
    </Modal>
  )
}

/** 新建成功后提交凭据：先取一次交接材料，加密后再交回去；明文与密钥都不跨 IPC。 */
export async function submitNewChannelCredential(channelId: string, token: string): Promise<void> {
  const begin = await window.platform.channels.beginCredential({ id: channelId })
  const handoff = await encryptChannelHandoff(
    begin as Parameters<typeof encryptChannelHandoff>[0],
    channelId,
    'credential',
    { bot_token: token }
  )
  await window.platform.channels.submitCredential({ id: channelId, actorId: 'settings-user', handoff })
}
