import { useMemo, useState } from 'react'
import { Button, Select, Tooltip } from 'antd'
import { CalendarClock, FolderOpen, Settings2, SquarePen, TerminalSquare, Trash2 } from 'lucide-react'

import type { AgentEntity, UniqueModelId } from '@platform/ai/agent-platform/schemas/agentSchemas'
import type { AgentRuntimeCompatibilityResult } from '@platform/ai/agent-platform/runtime/compatibility/agentRuntimeCompatibilityTypes'
import type { AgentSessionEntity } from '@platform/ai/agent-platform/schemas/sessionSchemas'
import type { AgentStoreState } from '@platform/ai/agent-platform/store/agentStore'
import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'
import type { ChatSettings } from '@platform/settings/schema/appSettings'

import { getAgentAvatar, getAgentPermissionModeLabel } from '../../agentUiTypes'
import {
  addWorkspaceAndSetSession,
  clearSessionMessages,
  setAgentModel,
  setSessionWorkspace
} from '../../agentStateActions'
import AgentChatSettingsDrawer from '../AgentChatSettingsDrawer'
import { buildAgentModelOptions, flattenAgentModelOptions } from '../../agentModelOptions'
import {
  clearSessionMessagesViaApi,
  setAgentModelViaApi,
  setSessionWorkspaceByPathViaApi,
  setSessionWorkspaceViaApi
} from '../../agentSessionDataApi'
import { useAgentLanguage, useAgentText } from '../../agentTextProvider'
import { platformText } from '../../../../i18n/platformText'
import {
  isUnconfiguredAgentModel,
  resolveConfiguredAgentModel
} from '@platform/ai/agent-platform/runtime/effectiveAgentModel'
import { ModelPicker } from '../../../components/ModelPicker/ModelPicker'
import type { ModelPickerCandidate } from '../../../components/ModelPicker/modelPickerOptions'
import AgentTaskCenterDrawer from '../AgentTaskCenterDrawer'
import { resolveTaskWorkspaceSource } from '../../agentTaskCenterViewModel'
import OpenExternalAppButton from './OpenExternalAppButton'

type AgentChatNavbarProps = {
  state: AgentStoreState
  providers: SafeModelProvider[]
  activeAgent: AgentEntity
  activeSession: AgentSessionEntity
  compatibilityByModelKey?: ReadonlyMap<string, AgentRuntimeCompatibilityResult>
  /** 模型服务页「默认智能体模型」：智能体没绑定模型时，选择器显示「跟随默认」。 */
  defaultAgentModelId?: string
  onStateChange: (updater: (state: AgentStoreState) => AgentStoreState) => void
  onChatSettingsChange: (settings: ChatSettings) => void
  onEditAgent: (agentId: string) => void
}

/**
 * 智能体工具栏选择器的约束（唯一事实）：智能体运行时走 Anthropic `/v1/messages`，
 * 因此只列 messages 且具备 chat 能力的模型；已下线由数据层默认剔除。
 */
const AGENT_MODEL_PICKER_CONSTRAINTS = {
  requireCapabilities: ['chat'],
  protocols: ['messages'],
  showProtocolFilter: true
} as const

export default function AgentChatNavbar({
  state,
  providers,
  activeAgent,
  activeSession,
  compatibilityByModelKey,
  defaultAgentModelId,
  onStateChange,
  onChatSettingsChange,
  onEditAgent
}: AgentChatNavbarProps): React.ReactElement {
  const t = useAgentText()
  const language = useAgentLanguage()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [taskCenterOpen, setTaskCenterOpen] = useState(false)
  // 智能体候选仍是 `buildAgentModelOptions` 那一份判据；messages 硬约束由选择器数据层执行。
  const modelCandidates = useMemo<ModelPickerCandidate[]>(
    () =>
      flattenAgentModelOptions(
        buildAgentModelOptions(providers, activeAgent.type, compatibilityByModelKey)
      )
        .filter((option) => option.selectable)
        .map((option) => ({ providerId: option.providerId, model: option.model })),
    [activeAgent.type, compatibilityByModelKey, providers]
  )
  // 智能体没有显式模型时，工具栏显示「跟随默认：<模型>」而不是 `unconfigured:` 原始值。
  const followsDefaultModel = isUnconfiguredAgentModel(activeAgent.model)
  const defaultModelLabel = useMemo(() => {
    if (!followsDefaultModel) return null
    const resolved = resolveConfiguredAgentModel({
      providers,
      configuredDefaultModelId: defaultAgentModelId,
      agentType: activeAgent.type
    })
    return resolved.ok ? resolved.modelName : null
  }, [activeAgent.type, defaultAgentModelId, followsDefaultModel, providers])
  const activeWorkspaceSource = useMemo(
    () => resolveTaskWorkspaceSource(activeSession),
    [activeSession.workspace.type, activeSession.workspaceId]
  )
  const workspaceOptions = useMemo(
    () => [
      ...state.workspaces.map((workspace) => ({
        value: workspace.id,
        // 系统工作区是界面概念，不是用户数据：显示 i18n 文案而不是落库的种子名字。
        label:
          workspace.type === 'system'
            ? t.common.systemWorkspace
            : workspace.name || workspace.path || t.common.systemWorkspace
      })),
      { value: '__select_directory__', label: t.chatNavbar.selectLocalDirectory }
    ],
    [state.workspaces, t.chatNavbar.selectLocalDirectory, t.common.systemWorkspace]
  )

  async function selectWorkspace(value: string): Promise<void> {
    if (value === '__select_directory__') {
      const path = (await window.platform.app.selectDirectory()) as string | null
      if (!path) return
      void setSessionWorkspaceByPathViaApi(window.platform, activeSession.id, path).catch(() => {
        onStateChange((current) => addWorkspaceAndSetSession(current, activeSession.id, path))
      })
      return
    }

    void setSessionWorkspaceViaApi(window.platform, activeSession.id, { type: 'user', workspaceId: value }).catch(() => {
      onStateChange((current) => setSessionWorkspace(current, activeSession.id, { type: 'user', workspaceId: value }))
    })
  }

  return (
    <header className="agent-chat-navbar">
      <div className="agent-chat-title">
        {/* 会话标题是从用户消息生成的，不放在智能体身份行里重复展示。 */}
        <div className="agent-chat-identity" aria-label={activeAgent.name}>
          <span className="agent-chat-avatar">{getAgentAvatar(activeAgent)}</span>
          <span className="agent-chat-identity-copy">
            <strong>{activeAgent.name}</strong>
          </span>
          <Tooltip title={t.chatNavbar.agentConfig}>
            <Button
              className="ant-shell-icon-button agent-chat-agent-config-button"
              type="text"
              size="small"
              icon={<SquarePen size={13} />}
              aria-label={t.chatNavbar.agentConfig}
              onClick={() => onEditAgent(activeAgent.id)}
            />
          </Tooltip>
        </div>
      </div>

      <div className="agent-chat-toolbar">
        <ModelPicker
          pickerId="agent-toolbar"
          value={followsDefaultModel ? null : activeAgent.model}
          onChange={(modelId: UniqueModelId) => {
            void setAgentModelViaApi(window.platform, activeAgent.id, modelId).catch(() => {
              onStateChange((current) => setAgentModel(current, activeAgent.id, modelId))
            })
          }}
          models={modelCandidates}
          providers={providers}
          labels={platformText[language].models}
          constraints={AGENT_MODEL_PICKER_CONSTRAINTS}
          placeholder={
            defaultModelLabel
              ? platformText[language].assistants.followDefaultModel(defaultModelLabel)
              : undefined
          }
          placement="bottomRight"
        />
        <Select
          className="agent-workspace-selector"
          variant="borderless"
          value={activeSession.workspaceId}
          options={workspaceOptions}
          suffixIcon={<FolderOpen size={13} />}
          popupMatchSelectWidth={false}
          onChange={(value) => void selectWorkspace(value)}
        />
        {activeSession.workspace.path ? (
          <Tooltip title={t.chatNavbar.openWorkspace}>
            <Button
              className="ant-shell-icon-button"
              type="text"
              size="small"
              icon={<TerminalSquare size={15} />}
              aria-label={t.chatNavbar.openWorkspace}
              onClick={() => void window.platform.app.openPath(activeSession.workspace.path)}
            />
          </Tooltip>
        ) : null}
        <OpenExternalAppButton workspacePath={activeSession.workspace.path} />
        <span className="agent-permission-chip">{getAgentPermissionModeLabel(activeAgent, t.permissionMode)}</span>
        <Tooltip title={t.chatNavbar.clearMessages}>
          <Button
            className="ant-shell-icon-button"
            type="text"
            size="small"
            icon={<Trash2 size={15} />}
            aria-label={t.chatNavbar.clearMessages}
            onClick={() => {
              if (!window.confirm(t.chatNavbar.confirmClearMessages(activeSession.name))) return
              void clearSessionMessagesViaApi(window.platform, activeSession.id).catch(() => {
                onStateChange((current) => clearSessionMessages(current, activeSession.id))
              })
            }}
          />
        </Tooltip>
        <Tooltip title={t.chatNavbar.taskCenter}>
          <Button
            className="ant-shell-icon-button"
            type="text"
            size="small"
            icon={<CalendarClock size={15} />}
            aria-label={t.chatNavbar.taskCenter}
            onClick={() => setTaskCenterOpen(true)}
          />
        </Tooltip>
        <Tooltip title={t.chatNavbar.chatSettings}>
          <Button
            className="ant-shell-icon-button"
            type="text"
            size="small"
            icon={<Settings2 size={15} />}
            aria-label={t.chatNavbar.chatSettings}
            onClick={() => setSettingsOpen(true)}
          />
        </Tooltip>
      </div>

      <AgentChatSettingsDrawer
        open={settingsOpen}
        state={state}
        agent={activeAgent}
        session={activeSession}
        onClose={() => setSettingsOpen(false)}
        onChatSettingsChange={onChatSettingsChange}
        onStateChange={onStateChange}
      />
      <AgentTaskCenterDrawer
        open={taskCenterOpen}
        state={state}
        agent={activeAgent}
        workspace={activeWorkspaceSource}
        onClose={() => setTaskCenterOpen(false)}
        onStateChange={onStateChange}
      />
    </header>
  )
}
