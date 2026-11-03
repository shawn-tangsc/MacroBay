import { Modal } from 'antd'
import { useEffect, useState } from 'react'

import type { PlatformText } from '../../../i18n/platformText'

import { ChannelFields, type ChannelFieldValues } from './ChannelFields'
import type { Agent } from './channelSettingsPresentation'
import { clearSensitiveDraft, encryptChannelHandoff } from './secureCredentialHandoff'

const EMPTY: ChannelFieldValues = { name: '', agentId: '', token: '' }

/**
 * 「＋ 添加」的弹层：六字段布局与编辑弹层共用（需求 v7 要求新建和编辑统一）。
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
  const [values, setValues] = useState<ChannelFieldValues>(EMPTY)

  useEffect(() => () => clearSensitiveDraft(() => setValues(EMPTY)), [])

  const ready = values.name.trim().length > 0 && values.agentId.length > 0 && values.token.trim().length > 0

  return (
    <Modal
      cancelText={labels.channelCancel}
      okButtonProps={{ disabled: !ready, loading: props.saving }}
      okText={labels.channelCreate}
      onCancel={props.onCancel}
      onOk={() => props.onCreate({ name: values.name.trim(), agentId: values.agentId, token: values.token })}
      open
      title={labels.channelCreate}
    >
      <ChannelFields
        agents={props.agents}
        labels={labels}
        mode="create"
        onChange={(patch) => setValues((previous) => ({ ...previous, ...patch }))}
        values={values}
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
