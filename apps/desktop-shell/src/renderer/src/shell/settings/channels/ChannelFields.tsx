import { Input, Select } from 'antd'

import type { PlatformText } from '../../../i18n/platformText'

import type { Agent } from './channelSettingsPresentation'

export type ChannelFieldValues = { name: string; agentId: string; token: string }

/**
 * 新建与编辑共用的六字段布局（原型 B，顺序即必填到可选）：
 * 名称 → 绑定智能体 → 工作目录 → Bot Token → 允许的会话 ID → 频道权限模式。
 *
 * **两个弹层共用这一个组件**，因为需求定的是「新建和编辑统一，别做两套」——两套布局的下一步
 * 就是两份校验、两处文案。
 *
 * 后三个字段里，工作目录 / 允许的会话 ID / 权限模式**后端还没接**：接口的 create/update 只收
 * { type, name, agentId }。所以它们**禁用并写清原因**，不做成「能改、保存成功、其实没存」。
 * 接口到了之后只把 `disabled` 换成真的取值，布局一个字都不用动。
 */
export function ChannelFields(props: {
  mode: 'create' | 'edit'
  values: ChannelFieldValues
  agents: readonly Agent[]
  labels: PlatformText['settings']
  onChange: (patch: Partial<ChannelFieldValues>) => void
}): React.ReactElement {
  const { labels, values } = props

  return (
    <div className="channel-fields">
      <Input
        aria-label={labels.channelName}
        autoFocus
        onChange={(event) => props.onChange({ name: event.target.value })}
        placeholder={labels.channelName}
        value={values.name}
      />
      <Select
        aria-label={labels.channelAgentId}
        onChange={(value: string) => props.onChange({ agentId: value })}
        options={props.agents.map((agent) => ({ value: agent.id, label: agent.name }))}
        placeholder={labels.channelAgentId}
        style={{ marginTop: 10, width: '100%' }}
        value={values.agentId.length === 0 ? undefined : values.agentId}
      />

      <FieldShell hint={labels.channelFieldNotSavable} label={labels.channelFieldWorkspace}>
        <Select
          aria-label={labels.channelFieldWorkspace}
          disabled
          options={[{ value: 'default', label: labels.channelWorkspaceDefault }]}
          value="default"
        />
      </FieldShell>

      <FieldShell hint={null} label={labels.channelCredential}>
        {props.mode === 'create' ? (
          <Input.Password
            aria-label={labels.channelCredential}
            autoComplete="off"
            onChange={(event) => props.onChange({ token: event.target.value })}
            placeholder={labels.channelCredential}
            value={values.token}
          />
        ) : (
          // 编辑时只有圆点：要露任何真值字符都得让主进程解明文再切片，那正是被否掉的口子。
          <span className="channel-token-dots" aria-label={labels.channelCredential}>
            {labels.channelTokenMask}
            <small className="channel-field-hint">{labels.channelTokenReadOnly}</small>
          </span>
        )}
      </FieldShell>

      <FieldShell hint={labels.channelFieldNotSavable} label={labels.channelFieldAllowedChats}>
        <Input aria-label={labels.channelFieldAllowedChats} disabled placeholder={labels.channelFieldAllowedChats} />
      </FieldShell>

      <FieldShell hint={labels.channelFieldNotSavable} label={labels.channelFieldPermissionMode}>
        <Select
          aria-label={labels.channelFieldPermissionMode}
          disabled
          options={[{ value: 'inherit', label: labels.channelPermissionInherit }]}
          value="inherit"
        />
      </FieldShell>
    </div>
  )
}

function FieldShell(props: {
  label: string
  hint: string | null
  children: React.ReactNode
}): React.ReactElement {
  return (
    <label className="channel-field">
      <span className="channel-field-label">{props.label}</span>
      {props.children}
      {props.hint === null ? null : <small className="channel-field-hint">{props.hint}</small>}
    </label>
  )
}
