import { Input, Select } from 'antd'
import { Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'

import { IconButton } from '@platform/ui/components/icon-button'

import { SettingInfoPopover } from '../SettingInfoPopover'

import type { PlatformText } from '../../../i18n/platformText'

import type { Agent } from './channelSettingsPresentation'

export type ChannelFieldValues = {
  name: string
  agentId: string
  token: string
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
 * 新建与编辑共用的字段布局（顺序即必填到可选）：
 * 名称 → 绑定智能体 → Bot Token → 允许的会话 ID。
 *
 * **两个弹层共用这一个组件**，因为需求定的是「新建和编辑统一，别做两套」。
 *
 * 这一屏只回答两件事：「这条频道是什么（名字/类型/凭据）」+「开不开」。工作目录与权限模式
 * 曾在这里各占一栏，2026-11-10 撤掉：权限是**智能体级**的事实，频道再存一份就是读者拦不住、
 * 却以为拦住了的假安全感；入站会话用的是智能体工作区，频道级目录会成为第二个工作区权威。
 * 两个存储列留着（不迁移、不删），但不再由读者写入。
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
  onChange: (patch: Partial<ChannelFieldValues>) => void
}): React.ReactElement {
  const { labels, values } = props
  // 输入中的新 Token 临时可见；旧值永远不经过这个开关（接口里就没有旧值）。
  const [tokenVisible, setTokenVisible] = useState(false)

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

      <FieldShell
        info={
          <SettingInfoPopover
            hintKeys={[props.tokenState === 'missing' ? 'channelTokenEnterHint' : props.tokenState === 'unavailable' ? 'channelTokenUnavailableHint' : 'channelTokenReadOnly', ...(tokenVisible ? ['channelTokenVisibleHint'] : [])]}
            infoLabelKey="settings.channels.tokenInfo"
            resolveText={(key: string) =>
              key === 'settings.channels.tokenInfo'
                ? labels.channelTokenInfoAria
                : (labels as unknown as Record<string, string>)[key] ?? ''
            }
          />
        }
        label={labels.channelCredential}>
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
            <small className="channel-field-hint">
              {/* 正文最多一行：三档三句里只留**当前状态**那一句；「显示/隐藏」的解释进 ⓘ。 */}
              {props.tokenState === 'missing'
                ? labels.channelTokenEnterHint
                : props.tokenState === 'unavailable'
                  ? labels.channelTokenUnavailableHint
                  : labels.channelTokenReadOnly}
            </small>
          </>
        )}
      </FieldShell>

      <FieldShell
        info={
          <SettingInfoPopover
            hintKey="channelAllowedChatsHint"
            infoLabelKey="settings.channels.allowedChatsInfo"
            resolveText={(key: string) =>
              key === 'settings.channels.allowedChatsInfo'
                ? labels.channelAllowedChatsInfoAria
                : (labels as unknown as Record<string, string>)[key] ?? ''
            }
          />
        }
        label={labels.channelFieldAllowedChats}>
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
    </div>
  )
}

/**
 * 一个字段 = 字段名（旁边可挂一颗 ⓘ）+ 控件（下边最多一行状态句）。
 *
 * **说明进 ⓘ**（用户口径，2026-11-11）：字段名旁边的 ⓘ 承载解释，正文只留字段名 / 值 / 控件 /
 * 一行状态。外壳从 `<label>` 换成 `<div>`：控件各自带 `aria-label`（见上），而 `<label>` 里再放一颗
 * 按钮会让 label 的关联对象变成那颗按钮——那正是「点字段名没反应」的来源。
 */
function FieldShell(props: {
  label: string
  info?: React.ReactNode
  children: React.ReactNode
}): React.ReactElement {
  return (
    <div className="channel-field">
      <div className="channel-field-label-row">
        <span className="channel-field-label">{props.label}</span>
        {props.info}
      </div>
      {props.children}
    </div>
  )
}
