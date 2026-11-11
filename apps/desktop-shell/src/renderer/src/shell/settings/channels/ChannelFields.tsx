import { Input, Select } from 'antd'
import { Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'

import { IconButton } from '@platform/ui/components/icon-button'
import { InlineNotice } from '@platform/ui/components/inline-notice'

import { SettingInfoPopover } from '../SettingInfoPopover'

import type { PlatformText } from '../../../i18n/platformText'

import type { Agent } from './channelSettingsPresentation'

export type ChannelFieldValues = {
  name: string
  agentId: string
  /** 凭据字段 → 输入值。字段清单来自适配器描述符（`credentialFields`），不在界面里写死平台名。 */
  credentials: Record<string, string>
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
  /** 这个平台的凭据字段（来自描述符）：每一项一个输入框，顺序即描述符顺序。 */
  credentialFields: readonly string[]
  /** 主进程算好的旧值掩码：编辑时按字段显示「当前已存」，界面从不回填明文。 */
  maskedFields?: Readonly<Record<string, string>>
  /** 逐字段的校验错误：挂在**对应那一行**，不是弹层底部一句笼统的「保存失败」。 */
  credentialErrors?: Readonly<Record<string, string>>
  /**
   * 编辑时库里凭据的真实档位：决定输入框下面那句提示。
   * `configured` → 留空＝不改；`missing` → 填一个，留空什么都不会存；`unavailable` → 填新的换掉它。
   */
  tokenState?: 'configured' | 'missing' | 'unavailable'
  onChange: (patch: Partial<ChannelFieldValues>) => void
}): React.ReactElement {
  const { labels, values } = props
  // 每个字段一个「临时可见」开关：只让**正在输入的新值**可以被看一眼，旧值没有回显路径。
  const [visibleFields, setVisibleFields] = useState<Readonly<Record<string, boolean>>>({})

  const fieldLabel = (field: string): string =>
    (labels.channelCredentialField as Readonly<Record<string, string>>)[field] ?? field

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

      {props.credentialFields.map((field) => {
        const label = fieldLabel(field)
        const visible = visibleFields[field] === true
        const error = props.credentialErrors?.[field]
        const masked = props.maskedFields?.[field]
        return (
          <FieldShell
            info={
              <SettingInfoPopover
                hintKeys={[props.tokenState === 'missing' ? 'channelTokenEnterHint' : props.tokenState === 'unavailable' ? 'channelTokenUnavailableHint' : 'channelTokenReadOnly', ...(visible ? ['channelTokenVisibleHint'] : [])]}
                infoLabelKey="settings.channels.tokenInfo"
                resolveText={(key: string) =>
                  key === 'settings.channels.tokenInfo'
                    ? labels.channelTokenInfoAria
                    : (labels as unknown as Record<string, string>)[key] ?? ''
                }
              />
            }
            key={field}
            label={label}>
            <div className="channel-field-with-toggle">
              <Input
                aria-label={label}
                autoComplete="off"
                onChange={(event) =>
                  props.onChange({ credentials: { ...values.credentials, [field]: event.target.value } })}
                placeholder={
                  props.mode === 'edit'
                    ? masked
                      ? labels.channelTokenCurrent.replace('{mask}', masked)
                      : labels.channelTokenReplaceHint
                    : label
                }
                type={props.mode === 'create' || visible ? 'text' : 'password'}
                value={values.credentials[field] ?? ''}
              />
              {props.mode === 'edit' ? (
                <IconButton
                  ariaLabelKey="settings.channels.tokenVisibility"
                  icon={visible ? EyeOff : Eye}
                  onSelect={() => setVisibleFields((current) => ({ ...current, [field]: !visible }))}
                  pressed={visible}
                  resolveText={(key) => (key === 'settings.channels.tokenVisibility' ? labels.channelTokenVisibility : '')}
                  size="sm"
                  tooltipKey="settings.channels.tokenVisibility"
                />
              ) : null}
            </div>
            {error ? (
              // 平台提示条：danger 档自带 role="alert"，位置与句子不变，不再手写裸 alert。
              <div data-field-error={field}>
                <InlineNotice tone="danger">{error}</InlineNotice>
              </div>
            ) : null}
          </FieldShell>
        )
      })}

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
