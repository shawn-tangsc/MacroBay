import { Button } from 'antd'

import { Modal } from '@platform/ui/components/modal'
import { useEffect, useState } from 'react'

import type { PlatformText } from '../../../i18n/platformText'

import { ChannelFields, parseAllowedChatIds, type ChannelFieldValues } from './ChannelFields'
import type { Agent } from './channelSettingsPresentation'
import { clearSensitiveDraft, encryptChannelHandoff } from './secureCredentialHandoff'

const EMPTY: ChannelFieldValues = { name: '', agentId: '', token: '', workspaceId: null, permissionMode: null, allowedChatIdsText: '' }

/**
 * 「＋ 添加」的弹层：六字段布局与编辑弹层共用（需求 v7 要求新建和编辑统一）。
 *
 * Token 只在这里出现一次，且**只进不出**：提交走平台的凭据交接（WebCrypto 加密后再过 IPC），
 * 成功后立刻清空草稿。列表里它永远只是星号——这一条是安全口径，不是排版偏好。
 */
export function ChannelCreateDialog(props: {
  agents: readonly Agent[]
  labels: PlatformText['settings']
  /** 创建失败/凭据没存上时的就地一句话：页面级那句在遮罩后面，读者看不见。 */
  saveError?: string | null
  saving: boolean
  onCancel: () => void
  onCreate: (input: {
    name: string
    agentId: string
    token: string
    workspaceId: string | null
    permissionMode: ChannelFieldValues['permissionMode']
    allowedChatIds: readonly string[]
  }) => void
}): React.ReactElement {
  const { labels } = props
  const [values, setValues] = useState<ChannelFieldValues>(EMPTY)

  useEffect(() => () => clearSensitiveDraft(() => setValues(EMPTY)), [])

  const ready = values.name.trim().length > 0 && values.agentId.length > 0 && values.token.trim().length > 0

  return (
    <Modal
      open
      width="standard"
      onClose={props.onCancel}
      titleKey="settings.channels.create"
      resolveText={(key) => (key === 'settings.channels.create' ? labels.channelCreate : '')}
      footer={
        <>
          <Button key="cancel" onClick={props.onCancel}>
            {labels.channelCancel}
          </Button>
          <Button
            disabled={!ready}
            key="create"
            loading={props.saving}
            onClick={() =>
              props.onCreate({
                name: values.name.trim(),
                agentId: values.agentId,
                token: values.token,
                workspaceId: values.workspaceId,
                permissionMode: values.permissionMode,
                allowedChatIds: parseAllowedChatIds(values.allowedChatIdsText)
              })
            }
            type="primary">
            {labels.channelCreate}
          </Button>
        </>
      }
    >
      {props.saveError ? (
        <p className="channel-inline-error" data-channel-save-error role="alert">
          {props.saveError}
        </p>
      ) : null}
      <ChannelFields
        agents={props.agents}
        labels={labels}
        mode="create"
        policyPresence="none"
        onChange={(patch) => setValues((previous) => ({ ...previous, ...patch }))}
        values={values}
      />
    </Modal>
  )
}

/**
 * 新建成功后提交凭据：先取一次交接材料，加密后再交回去；明文与密钥都不跨 IPC。
 *
 * 把返回**交回调用方**：`submitCredential` 失败时会正常返回 `{ ok: false, code }` 而不抛错，
 * 调用方不看这个字段，就会把一次没落库的提交当成成功——用户上一次就是这么被误导的。
 */
export async function submitNewChannelCredential(
  channelId: string,
  token: string
): Promise<{ ok?: boolean; code?: string } | undefined> {
  const begin = await window.platform.channels.beginCredential({ id: channelId })
  const handoff = await encryptChannelHandoff(
    begin as Parameters<typeof encryptChannelHandoff>[0],
    channelId,
    'credential',
    { bot_token: token }
  )
  return (await window.platform.channels.submitCredential({
    id: channelId,
    actorId: 'settings-user',
    handoff
  })) as { ok?: boolean; code?: string } | undefined
}
