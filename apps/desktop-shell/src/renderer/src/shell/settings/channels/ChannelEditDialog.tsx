import { Button } from 'antd'

import { Modal } from '@platform/ui/components/modal'
import { useEffect, useState } from 'react'

import type { PlatformText } from '../../../i18n/platformText'

import { ChannelFields, parseAllowedChatIds, type ChannelFieldValues, type ChannelPolicyPresence } from './ChannelFields'
import { credentialPayload } from './credentialFieldsModel'
import type { Agent, Channel } from './channelSettingsPresentation'

/**
 * 编辑弹层：与新建**同一套字段布局**（需求 v7）。
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
  /** 这个平台的凭据字段（来自描述符）：弹层按它逐项渲染，不按平台写 if。 */
  credentialFields: readonly string[]
  onSave: (input: {
    name: string
    agentId: string
    allowedChatIds: readonly string[]
    /** **只含填了的字段**：留空＝保持原值（旧值不可读，界面不能拿掩码回填）。 */
    credentials: Record<string, string>
  }) => void
}): React.ReactElement {
  const { labels, channel } = props
  const fromChannel = (target: Channel): ChannelFieldValues => ({
    name: target.name,
    agentId: target.agentId,
    // 旧值不可读：每个字段都从空开始，留空＝不改。
    credentials: {},
    allowedChatIdsText: (target.allowedChatIds ?? []).join('\n')
  })
  const [values, setValues] = useState<ChannelFieldValues>(fromChannel(channel))

  useEffect(() => {
    setValues(fromChannel(channel))
  }, [channel.id, channel.name, channel.agentId])

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
                allowedChatIds: parseAllowedChatIds(values.allowedChatIdsText),
                // 编辑允许只填其中一项：提交的载荷里只有填了的那些键。
                credentials: credentialPayload(props.credentialFields, values.credentials, 'edit').payload
              })
            }
            type="primary">
            {labels.channelUpdate}
          </Button>
        </>
      }
    >
      <div className="channel-edit-current" data-current-token>
        {/* 每个字段各显示自己的掩码（主进程算好送来的），不显示「最近更新」：安全视图里没有凭据时间戳，
            拿频道记录的 updated_at 冒充它，就是另一种说假话。**没有凭据时不许写「已存：********」**。 */}
        {channel.credential.status === 'configured' ? (
          props.credentialFields.map((field) => {
            const label = (labels.channelCredentialField as Readonly<Record<string, string>>)[field] ?? field
            const mask = channel.credential.maskedFields?.[field] ?? labels.channelTokenMask
            return (
              <p key={field}>
                {label}
                {' · '}
                {labels.channelTokenCurrent.replace('{mask}', mask)}
              </p>
            )
          })
        ) : (
          <p>{channel.credential.status === 'unavailable' ? labels.channelTokenUnavailable : labels.channelTokenCurrentNone}</p>
        )}
        {/* 「改没改成功」的第二条凭据：保存次数。不是时间——没有凭据时间戳，写时间就是假话。 */}
        {channel.credential.status === 'configured' && typeof channel.credential.revision === 'number'
          ? ` · ${labels.channelTokenRevision.replace('{count}', String(channel.credential.revision))}`
          : ''}
      </div>
      {props.saveError ? (
        <p className="channel-inline-error" data-channel-save-error role="alert">
          {props.saveError}
        </p>
      ) : null}
      <ChannelFields
        agents={props.agents}
        credentialFields={props.credentialFields}
        labels={labels}
        maskedFields={channel.credential.maskedFields}
        mode="edit"
        policyPresence={props.policyPresence}
        onChange={(patch) => setValues((previous) => ({ ...previous, ...patch }))}
        tokenState={channel.credential.status}
        values={values}
      />
    </Modal>
  )
}
