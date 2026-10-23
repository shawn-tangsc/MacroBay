import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Drawer } from 'antd'
import { Check, FileText, Settings, Shield, SlidersHorizontal, Trash2, Wrench, X } from 'lucide-react'

import {
  AGENT_CONFIG_SECTIONS,
  applyAgentFormPatch,
  buildAgentFormStateForEditor,
  diffAgentSaveIntent,
  type AgentConfigSection,
  type AgentFormState
} from '@platform/ai/agent-platform/agents/agentConfigDescriptor'
import type { AgentStoreState } from '@platform/ai/agent-platform/store/agentStore'
import type { AgentSkillBinding } from '@platform/ai/agent-platform/store/agentStore'
import { setAgentSkillEnabled } from '@platform/ai/agent-platform/store/agentRelationsStore'
import { buildAgentToolCatalog } from '@platform/ai/agent-platform/tools/agentToolCatalog'
import { normalizePermissionMode } from '@platform/ai/agent-platform/schemas/agentSchemas'
import type { AgentRuntimeCompatibilityResult } from '@platform/ai/agent-platform/runtime/compatibility/agentRuntimeCompatibilityTypes'
import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'

import type { AgentEditorMode } from '../agentUiTypes'
import AdvancedSection from './sections/AdvancedSection'
import BasicSection from './sections/BasicSection'
import PermissionSection from './sections/PermissionSection'
import PromptSection from './sections/PromptSection'
import ToolsSection from './sections/ToolsSection'
import { deleteAgentConfig, saveAgentConfig } from '../agentStateActions'
import { useAgentText } from '../agentTextProvider'
import { deleteAgentViaApi, saveAgentConfigViaApi } from '../agentSessionDataApi'
import { planMcpToolRefreshes } from './agentMcpRefreshPlanner'

type AgentConfigPageProps = {
  mode: AgentEditorMode
  state: AgentStoreState
  providers: SafeModelProvider[]
  /** 新建时预填「默认智能体模型」（用户仍可改成别的；运行时未设置才回退默认）。 */
  defaultModelId?: string
  compatibilityByModelKey?: ReadonlyMap<string, AgentRuntimeCompatibilityResult>
  onStateChange: (updater: (state: AgentStoreState) => AgentStoreState) => void
  onClose: () => void
}

const sectionIcons: Record<AgentConfigSection, typeof Settings> = {
  basic: Settings,
  prompt: FileText,
  permission: Shield,
  tools: Wrench,
  advanced: SlidersHorizontal
}

export default function AgentConfigPage({
  mode,
  state,
  providers,
  defaultModelId,
  compatibilityByModelKey,
  onStateChange,
  onClose
}: AgentConfigPageProps): React.ReactElement {
  const t = useAgentText()
  const editingAgent = mode.type === 'edit' ? state.agents.find((agent) => agent.id === mode.agentId) ?? null : null
  const [activeSection, setActiveSection] = useState<AgentConfigSection>('basic')
  const baseline = useMemo(
    () => buildAgentFormStateForEditor(editingAgent, defaultModelId),
    [defaultModelId, editingAgent]
  )
  const [form, setForm] = useState<AgentFormState>(() => baseline)
  const [skillBindingsDraft, setSkillBindingsDraft] = useState<AgentSkillBinding[]>(() => state.agentSkills)
  const requestedMcpRefreshes = useRef(new Set<string>())
  const visibleSections = form.soulEnabled ? AGENT_CONFIG_SECTIONS.filter((section) => section !== 'permission') : AGENT_CONFIG_SECTIONS
  const tools = useMemo(
    () =>
      buildAgentToolCatalog({
        agent: {
          type: 'claude-code',
          mcps: form.mcps,
          disabledTools: form.disabledTools,
          configuration: { permission_mode: normalizePermissionMode(form.permissionMode) }
        },
        mcpServers: state.mcpServers,
        mcpToolsByServerId: state.mcpToolsByServerId
      }),
    [form.disabledTools, form.mcps, form.permissionMode, state.mcpServers, state.mcpToolsByServerId]
  )
  const title = mode.type === 'create' ? form.name.trim() || t.editor.titleCreate : form.name || editingAgent?.name || t.editor.titleConfig
  const saveIntent = diffAgentSaveIntent(form, baseline, editingAgent)

  function updateForm(patch: Partial<AgentFormState>): void {
    setForm((current) => applyAgentFormPatch(current, patch, tools.all))
  }

  useEffect(() => {
    setForm(baseline)
    setSkillBindingsDraft(state.agentSkills)
    setActiveSection('basic')
  }, [baseline, state.agentSkills])

  useEffect(() => {
    const plannedServerIds = planMcpToolRefreshes({
      boundServerIds: form.mcps,
      servers: state.mcpServers,
      toolsByServerId: state.mcpToolsByServerId,
      requestedServerIds: requestedMcpRefreshes.current
    })

    plannedServerIds.forEach((serverId) => {
      requestedMcpRefreshes.current.add(serverId)
      void window.platform.agents.refreshMcpTools(serverId).catch(() => {
        requestedMcpRefreshes.current.delete(serverId)
      })
    })
  }, [form.mcps, state.mcpServers, state.mcpToolsByServerId])

  function save(): void {
    const skillPatch = diffSkillBindings(state.agentSkills, skillBindingsDraft, editingAgent?.id ?? null)
    if (!saveIntent && skillPatch.length === 0) return
    if (saveIntent) {
      void saveAgentConfigViaApi(window.platform, saveIntent, editingAgent?.id ?? null).catch(() => {
        onStateChange((current) => saveAgentConfig(current, saveIntent, editingAgent?.id ?? null))
      })
    }
    if (skillPatch.length > 0) {
      onStateChange((current) => applySkillBindingPatch(current, editingAgent?.id ?? null, skillPatch))
    }
    onClose()
  }

  function deleteCurrentAgent(): void {
    if (!editingAgent) return
    if (!window.confirm(t.editor.confirmDeleteAgent(editingAgent.name))) return
    void deleteAgentViaApi(window.platform, editingAgent.id).catch(() => {
      onStateChange((current) => deleteAgentConfig(current, editingAgent.id))
    })
    onClose()
  }

  async function toggleSkillDraft(skillId: string, checked: boolean): Promise<void> {
    if (!editingAgent) return
    setSkillBindingsDraft((current) => updateSkillBindingDraft(current, editingAgent.id, skillId, checked))
    try {
      await window.platform.agents.skills.toggle({ agentId: editingAgent.id, skillId, isEnabled: checked })
    } catch (error) {
      setSkillBindingsDraft((current) => updateSkillBindingDraft(current, editingAgent.id, skillId, !checked))
      throw error
    }
  }

  const hasSkillChanges = diffSkillBindings(state.agentSkills, skillBindingsDraft, editingAgent?.id ?? null).length > 0

  return (
    <Drawer
      open
      width={860}
      title={title}
      placement="right"
      onClose={onClose}
      className="agent-config-drawer"
      extra={
        <div className="agent-config-actions">
          {editingAgent ? (
            <Button
              danger
              className="ant-secondary-button"
              size="small"
              icon={<Trash2 size={14} />}
              onClick={deleteCurrentAgent}>
              {t.editor.deleteAgent}
            </Button>
          ) : null}
          <Button className="ant-secondary-button" size="small" icon={<X size={14} />} onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button className="ant-primary-button" size="small" icon={<Check size={14} />} disabled={!saveIntent && !hasSkillChanges} onClick={save}>
            {t.common.save}
          </Button>
        </div>
      }>
      <div className="agent-config-editor">
        <aside className="agent-config-section-nav">
          {visibleSections.map((section) => {
            const meta = t.editor.sections[section]
            const Icon = sectionIcons[section]
            return (
              <button
                key={section}
                type="button"
                className={activeSection === section ? 'agent-config-section-button active' : 'agent-config-section-button'}
                onClick={() => setActiveSection(section)}>
                <Icon size={16} />
                <span>
                  <strong>{meta.label}</strong>
                  <small>{meta.desc}</small>
                </span>
              </button>
            )
          })}
        </aside>

        <main className="agent-config-section-body">
          {activeSection === 'basic' ? (
            <BasicSection
              form={form}
              providers={providers}
              compatibilityByModelKey={compatibilityByModelKey}
              onChange={updateForm}
            />
          ) : null}
          {activeSection === 'prompt' ? <PromptSection form={form} onChange={updateForm} /> : null}
          {activeSection === 'permission' && !form.soulEnabled ? <PermissionSection form={form} onChange={updateForm} /> : null}
          {activeSection === 'tools' ? (
            <ToolsSection
              agentId={editingAgent?.id ?? ''}
              state={state}
              tools={tools.all}
              form={form}
              skillBindings={skillBindingsDraft}
              onChange={updateForm}
              onSkillToggle={toggleSkillDraft}
            />
          ) : null}
          {activeSection === 'advanced' ? <AdvancedSection form={form} onChange={updateForm} /> : null}
        </main>
      </div>
    </Drawer>
  )
}

function updateSkillBindingDraft(
  current: readonly AgentSkillBinding[],
  agentId: string,
  skillId: string,
  isEnabled: boolean
): AgentSkillBinding[] {
  const next = current.filter((binding) => !(binding.agentId === agentId && binding.skillId === skillId))
  return [...next, { agentId, skillId, isEnabled }]
}

function diffSkillBindings(
  baseline: readonly AgentSkillBinding[],
  next: readonly AgentSkillBinding[],
  agentId: string | null
): AgentSkillBinding[] {
  if (!agentId) return []
  const baselineBySkillId = new Map(
    baseline.filter((binding) => binding.agentId === agentId).map((binding) => [binding.skillId, binding.isEnabled])
  )

  return next
    .filter((binding) => binding.agentId === agentId)
    .filter((binding) => baselineBySkillId.get(binding.skillId) !== binding.isEnabled)
}

function applySkillBindingPatch(
  state: AgentStoreState,
  agentId: string | null,
  patch: readonly AgentSkillBinding[]
): AgentStoreState {
  if (!agentId || patch.length === 0) return state
  return patch.reduce((current, binding) => setAgentSkillEnabled(current, agentId, binding.skillId, binding.isEnabled), state)
}
