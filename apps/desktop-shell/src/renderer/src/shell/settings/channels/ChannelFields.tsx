import { Input, Select } from 'antd'

import type { PlatformText } from '../../../i18n/platformText'

import type { Agent, ChannelPermissionMode } from './channelSettingsPresentation'

export type ChannelFieldValues = {
  name: string
  agentId: string
  token: string
  /** `null` = 系统默认目录。 */
  workspaceId: string | null
  /** `null` = 继承助手设置（**不是** `'default'`，那是助手级默认值）。 */
  permissionMode: ChannelPermissionMode | null
}

/**
 * 新建与编辑共用的六字段布局（原型 B，顺序即必填到可选）：
 * 名称 → 绑定智能体 → 工作目录 → Bot Token → 允许的会话 ID → 频道权限模式。
 *
 * **两个弹层共用这一个组件**，因为需求定的是「新建和编辑统一，别做两套」。
 *
 * 三个字段里已有两个能真正保存（工作目录、权限模式，接口 `64853a9` 起生效）；
 * 「允许的会话 ID」还在禁用并写明原因——后端那边的「留空＝允许所有」判定还没落，
 * 现在打开它并写「留空即放行」就是假话。接口到了只把 `disabled` 摘掉。
 */
export function ChannelFields(props: {
  mode: 'create' | 'edit'
  values: ChannelFieldValues
  agents: readonly Agent[]
  labels: PlatformText['settings']
  onChange: (patch: Partial<ChannelFieldValues>) => void
}): React.ReactElement {
  const { labels, values } = props

  const workspaceOptions = [
    { value: 'system', label: labels.channelWorkspaceDefault },
    // 本版没有「列出工作区」的接口：已经指定过工作区的那条频道，把它的工作区原样回显，
    // 不清空、也不假装能从列表里换一个（换到别的工作区等接口到了再做）。
    ...(values.workspaceId === null ? [] : [{ value: values.workspaceId, label: labels.channelWorkspaceCurrent }])
  ]

  const permissionOptions = [
    { value: 'inherit', label: labels.channelPermissionInherit },
    { value: 'default', label: labels.channelPermissionDefault },
    { value: 'acceptEdits', label: labels.channelPermissionAcceptEdits },
    { value: 'bypassPermissions', label: labels.channelPermissionBypass },
    { value: 'plan', label: labels.channelPermissionPlan }
  ]

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

      <FieldShell label={labels.channelFieldWorkspace}>
        <Select
          aria-label={labels.channelFieldWorkspace}
          onChange={(value: string) => props.onChange({ workspaceId: value === 'system' ? null : value })}
          options={workspaceOptions}
          style={{ width: '100%' }}
          value={values.workspaceId ?? 'system'}
        />
      </FieldShell>

      <FieldShell label={labels.channelCredential}>
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

      <FieldShell label={labels.channelFieldPermissionMode}>
        <Select
          aria-label={labels.channelFieldPermissionMode}
          onChange={(value: string) =>
            props.onChange({ permissionMode: value === 'inherit' ? null : (value as ChannelPermissionMode) })
          }
          options={permissionOptions}
          style={{ width: '100%' }}
          value={values.permissionMode ?? 'inherit'}
        />
      </FieldShell>
    </div>
  )
}

function FieldShell(props: {
  label: string
  hint?: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <label className="channel-field">
      <span className="channel-field-label">{props.label}</span>
      {props.children}
      {props.hint === undefined ? null : <small className="channel-field-hint">{props.hint}</small>}
    </label>
  )
}
