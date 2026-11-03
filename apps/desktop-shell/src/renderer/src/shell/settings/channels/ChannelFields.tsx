import { Input, Select } from 'antd'
import { Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'

import { IconButton } from '@platform/ui/components/icon-button'

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
  /** 逗号或换行分隔的原始文本：保存时才解析成列表。 */
  allowedChatIdsText: string
}

/** 这个频道有没有显式放行名单：决定「空列表」到底是不是「允许所有」。 */
export type ChannelPolicyPresence = 'none' | 'present' | 'unknown'

/** 解析读者粘进来的会话 ID：逗号、换行都算分隔，空行与空白丢掉。 */
export function parseAllowedChatIds(text: string): string[] {
  return text
    .split(/[,\n]/u)
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
}

/**
 * 新建与编辑共用的六字段布局（原型 B，顺序即必填到可选）：
 * 名称 → 绑定智能体 → 工作目录 → Bot Token → 允许的会话 ID → 频道权限模式。
 *
 * **两个弹层共用这一个组件**，因为需求定的是「新建和编辑统一，别做两套」。
 *
 * 三个字段现在都能真正保存（工作目录、权限模式自 `64853a9`；允许的会话 ID 自 `3a0e262`，
 * 那一笔把入站判定改成了「列表非空只放行名单内、空且无策略＝允许所有」）。
 *
 * 「允许的会话 ID」的文案必须**跟着真实状态**走：空列表在「没有显式名单」的频道上等于
 * 允许所有，这一步有风险；而同一个空列表在「已有显式名单」的频道上并不放开任何人。
 * 两种状态看起来一样，说法必须不同——判不出来就写「未知」，不许默认成其中一种。
 */
export function ChannelFields(props: {
  mode: 'create' | 'edit'
  values: ChannelFieldValues
  agents: readonly Agent[]
  labels: PlatformText['settings']
  policyPresence: ChannelPolicyPresence
  /**
   * 编辑时库里凭据的真实档位：决定输入框下面那句提示。
   * `configured` → 留空＝不改；`missing` → 填一个，留空什么都不会存；`unavailable` → 填新的换掉它。
   */
  tokenState?: 'configured' | 'missing' | 'unavailable'
  /** 读者已有的工作区（只列 `user` 那类）。 */
  workspaces?: readonly { id: string; name: string; path: string }[]
  /** 选文件夹：返回工作区编号（用户取消返回 null）。登记动作在主进程，这里只拿编号。 */
  onChooseWorkspace?: () => Promise<string | null>
  onChange: (patch: Partial<ChannelFieldValues>) => void
}): React.ReactElement {
  const { labels, values } = props
  // 输入中的新 Token 临时可见；旧值永远不经过这个开关（接口里就没有旧值）。
  const [tokenVisible, setTokenVisible] = useState(false)

  const CHOOSE_WORKSPACE = '__choose-directory__'
  const workspaceChoices = props.workspaces ?? []
  const currentMissing =
    values.workspaceId !== null && !workspaceChoices.some((workspace) => workspace.id === values.workspaceId)
  const workspaceOptions = [
    { value: 'system', label: labels.channelWorkspaceDefault },
    // 已经选过、但不在读者现有工作区列表里的那条（被删掉了）：原样回显它，不悄悄换成别的。
    ...(currentMissing ? [{ value: values.workspaceId as string, label: labels.channelWorkspaceCurrent }] : []),
    ...workspaceChoices.map((workspace) => ({ value: workspace.id, label: workspace.name })),
    { value: CHOOSE_WORKSPACE, label: labels.channelWorkspaceChoose }
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
          onChange={(value: string) => {
            // 「选择文件夹…」不是一次选择：它要先调系统窗口、登记工作区，拿到编号后才改这一栏。
            if (value === CHOOSE_WORKSPACE) {
              void props.onChooseWorkspace?.().then((workspaceId) => {
                if (workspaceId !== null && workspaceId !== undefined) props.onChange({ workspaceId })
              })
              return
            }
            props.onChange({ workspaceId: value === 'system' ? null : value })
          }}
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
          // 编辑时**可以替换**，但旧值不可读：输入框永远空着，留空＝不改。
          // 不用 Input.Password（它带「眼睛」＝查看入口），也不回显、不复制旧值。
          <>
            <div className="channel-field-with-toggle">
              <Input
                aria-label={labels.channelCredential}
                autoComplete="off"
                onChange={(event) => props.onChange({ token: event.target.value })}
                placeholder={labels.channelTokenReplaceHint}
                type={tokenVisible ? 'text' : 'password'}
                value={values.token}
              />
              {/* 只让**正在输入的新值**可以被看一眼：旧值没有回显路径，也没有复制入口。
                  读屏名保持恒定（`pressed` 表达状态），否则读屏会听到「隐藏…，已按下」。 */}
              <IconButton
                ariaLabelKey="settings.channels.tokenVisibility"
                icon={tokenVisible ? EyeOff : Eye}
                onSelect={() => setTokenVisible((current) => !current)}
                pressed={tokenVisible}
                resolveText={(key) => (key === 'settings.channels.tokenVisibility' ? labels.channelTokenVisibility : '')}
                size="sm"
                tooltipKey="settings.channels.tokenVisibility"
              />
            </div>
            {tokenVisible ? (
              <small className="channel-field-hint" data-token-visible-hint>
                {labels.channelTokenVisibleHint}
              </small>
            ) : null}
            <small className="channel-field-hint">
              {/* 三档三句：「留空＝不修改」只在真有一把可读的凭据时才是实话。 */}
              {props.tokenState === 'missing'
                ? labels.channelTokenEnterHint
                : props.tokenState === 'unavailable'
                  ? labels.channelTokenUnavailableHint
                  : labels.channelTokenReadOnly}
            </small>
          </>
        )}
      </FieldShell>

      <FieldShell hint={labels.channelAllowedChatsHint} label={labels.channelFieldAllowedChats}>
        <Input.TextArea
          aria-label={labels.channelFieldAllowedChats}
          autoSize={{ minRows: 2, maxRows: 4 }}
          onChange={(event) => props.onChange({ allowedChatIdsText: event.target.value })}
          placeholder={labels.channelFieldAllowedChats}
          value={values.allowedChatIdsText}
        />
      </FieldShell>

      {/* 空列表时**必须**说清现在是什么状态：只让输入框空着，读者会以为自己已经放开了。 */}
      {parseAllowedChatIds(values.allowedChatIdsText).length > 0 ? null : (
        <p className="channel-allowed-chats-status" data-allowed-chats-status={props.policyPresence} role="note">
          {props.policyPresence === 'present'
            ? labels.channelAllowedChatsPolicies
            : props.policyPresence === 'unknown'
              ? labels.channelAllowedChatsUnknown
              : `${labels.channelAllowedChatsAll} ${labels.channelAllowedChatsRisk}`}
        </p>
      )}

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
