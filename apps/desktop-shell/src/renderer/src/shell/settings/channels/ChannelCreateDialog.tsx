import { Button } from 'antd'

import { Modal } from '@platform/ui/components/modal'
import { useEffect, useState } from 'react'

import type { ChannelManagementResult } from '@platform/ai/agent-platform/channels/ChannelManagementContracts'
import type { PlatformText } from '../../../i18n/platformText'

import { ChannelFields, parseAllowedChatIds, type ChannelFieldValues } from './ChannelFields'
import { credentialPayload } from './credentialFieldsModel'
import type { Agent } from './channelSettingsPresentation'
import { clearSensitiveDraft, encryptChannelHandoff } from './secureCredentialHandoff'

const EMPTY: ChannelFieldValues = { name: '', agentId: '', credentials: {}, allowedChatIdsText: '' }

/**
 * 「＋ 添加」的弹层：与编辑弹层共用同一套字段（需求 v7 要求新建和编辑统一）。
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
  /** 这个平台的凭据字段（来自描述符）：弹层按它逐项渲染，不按平台写 if。 */
  credentialFields: readonly string[]
  onCreate: (input: {
    name: string
    agentId: string
    credentials: Record<string, string>
    allowedChatIds: readonly string[]
  }) => void
}): React.ReactElement {
  const { labels } = props
  const [values, setValues] = useState<ChannelFieldValues>(EMPTY)
  /** 逐字段的必填错误：挂在该字段下面，不是弹层底部一句笼统的话。 */
  const [credentialErrors, setCredentialErrors] = useState<Record<string, string>>({})

  useEffect(() => () => clearSensitiveDraft(() => setValues(EMPTY)), [])

  const fieldLabel = (field: string): string =>
    (labels.channelCredentialField as Readonly<Record<string, string>>)[field] ?? field
  const ready = values.name.trim().length > 0 && values.agentId.length > 0
  const submit = (): void => {
    const { payload, missing } = credentialPayload(props.credentialFields, values.credentials, 'create')
    if (missing.length > 0) {
      // 缺哪个字段就在哪一行说，别只说一句「保存失败」——读者不知道是哪一格没填。
      setCredentialErrors(Object.fromEntries(missing.map((field) => [
        field,
        labels.channelCredentialFieldRequired.replace('{field}', fieldLabel(field))
      ])))
      return
    }
    setCredentialErrors({})
    props.onCreate({
      name: values.name.trim(),
      agentId: values.agentId,
      credentials: payload,
      allowedChatIds: parseAllowedChatIds(values.allowedChatIdsText)
    })
  }

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
            onClick={submit}
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
        credentialErrors={credentialErrors}
        credentialFields={props.credentialFields}
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
  credentials: Readonly<Record<string, string>>
): Promise<ChannelManagementResult> {
  const begin = await window.platform.channels.beginCredential({ channelId })
  const handoff = await encryptChannelHandoff(
    begin as Parameters<typeof encryptChannelHandoff>[0],
    channelId,
    'credential',
    { ...credentials }
  )
  return window.platform.channels.submitCredential({ channelId, actorId: 'settings-user', handoff })
}
