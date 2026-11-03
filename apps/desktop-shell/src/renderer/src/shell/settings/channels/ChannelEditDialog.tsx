import { Button } from 'antd'

import { Modal } from '@platform/ui/components/modal'
import { useEffect, useState } from 'react'

import type { PlatformText } from '../../../i18n/platformText'

import { ChannelFields, type ChannelFieldValues } from './ChannelFields'
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
  saving: boolean
  onCancel: () => void
  onSave: (input: { name: string; agentId: string }) => void
}): React.ReactElement {
  const { labels, channel } = props
  const [values, setValues] = useState<ChannelFieldValues>({ name: channel.name, agentId: channel.agentId, token: '' })

  useEffect(() => {
    setValues({ name: channel.name, agentId: channel.agentId, token: '' })
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
            onClick={() => props.onSave({ name: values.name.trim(), agentId: values.agentId })}
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
        onChange={(patch) => setValues((previous) => ({ ...previous, ...patch }))}
        values={values}
      />
    </Modal>
  )
}
