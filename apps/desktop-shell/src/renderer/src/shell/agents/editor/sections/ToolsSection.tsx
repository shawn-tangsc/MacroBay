import { useEffect, useMemo, useState } from 'react'
import { Input, message } from 'antd'
import { Search, Wrench } from 'lucide-react'

import type { AgentFormState } from '@platform/ai/agent-platform/agents/agentConfigDescriptor'
import { buildAgentMcpCatalog } from '@platform/ai/agent-platform/mcp/agentMcpViewModel'
import type {
  AgentSkillRuntimeCatalogEntry,
  AgentSkillsRuntimeCatalog
} from '@platform/ai/agent-platform/skills/skillRuntimeSchemas'
import type { Tool } from '@platform/ai/agent-platform/schemas/toolSchemas'
import { buildAgentSkillCatalog } from '@platform/ai/agent-platform/skills/agentSkillViewModel'
import type { AgentSkillBinding, AgentStoreState } from '@platform/ai/agent-platform/store/agentStore'

import { Tabs } from '@platform/ui/components/tabs'

import { useAgentText } from '../../agentTextProvider'
import { BuiltinToolCatalog } from './tools/BuiltinToolCatalog'
import { resolveAgentTextKey } from '../../agentTooltipText'
import { StateView } from '@platform/ui/components/state'
import { STATE_VIEW_ACTION_KEYS } from '@platform/ui/components/state/stateViewText'
import { McpCatalog } from './tools/McpCatalog'
import { SkillCatalog } from './tools/SkillCatalog'
import { ProductToolPackagesCatalog } from './tools/ProductToolPackagesCatalog'
import { addManualMcpBinding } from './tools/agentMcpManualBinding'
import { matchesSearch, matchesText } from './tools/toolSearch'

type ToolsSectionProps = {
  agentId: string
  state: AgentStoreState
  tools: Tool[]
  form: AgentFormState
  skillBindings: AgentSkillBinding[]
  onChange: (patch: Partial<AgentFormState>) => void
  onSkillToggle: (skillId: string, checked: boolean) => void | Promise<void>
  /** 新智能体还没保存时，工具页的两个空态要能把人送到「保存」这一步。 */
  onSave: () => void
}

type ToolTab = 'tools' | 'mcp' | 'skills' | 'product-packages'

export default function ToolsSection({
  agentId,
  state,
  tools,
  form,
  skillBindings,
  onChange,
  onSkillToggle,
  onSave
}: ToolsSectionProps): React.ReactElement {
  const t = useAgentText()
  const [activeTab, setActiveTab] = useState<ToolTab>('tools')
  const [search, setSearch] = useState('')
  const [mcpDraft, setMcpDraft] = useState('')
  const [skillRuntime, setSkillRuntime] = useState<AgentSkillsRuntimeCatalog | null>(null)
  const disabledToolIds = useMemo(() => new Set(form.disabledTools), [form.disabledTools])
  const builtinTools = useMemo(() => tools.filter((tool) => tool.origin === 'builtin'), [tools])
  const visibleBuiltinTools = builtinTools.filter((tool) => matchesSearch(tool, search))
  const enabledBuiltinToolCount = builtinTools.filter((tool) => !disabledToolIds.has(tool.id)).length
  const mcpCatalog = useMemo(
    () => buildAgentMcpCatalog(state.mcpServers, form.mcps, search, state.mcpRuntimeStatusByServerId),
    [form.mcps, search, state.mcpRuntimeStatusByServerId, state.mcpServers]
  )
  const skillCatalog = useMemo(
    () => (agentId ? buildAgentSkillCatalog(state.skills, skillBindings, agentId, search) : []),
    [agentId, search, skillBindings, state.skills]
  )
  const skillRuntimeBySkillId = useMemo<ReadonlyMap<string, AgentSkillRuntimeCatalogEntry>>(
    () => new Map((skillRuntime?.skills ?? []).map((skill: AgentSkillRuntimeCatalogEntry) => [skill.skillId, skill])),
    [skillRuntime]
  )

  useEffect(() => {
    if (!agentId) {
      setSkillRuntime(null)
      return
    }

    let cancelled = false

    void window.platform.agents.skills
      .getRuntime(agentId)
      .then((snapshot) => {
        if (cancelled) return
        setSkillRuntime((snapshot as AgentSkillsRuntimeCatalog) ?? { agentId, skills: [] })
      })
      .catch(() => {
        if (cancelled) return
        setSkillRuntime({ agentId, skills: [] })
      })

    return () => {
      cancelled = true
    }
  }, [agentId, skillBindings, state.skills])

  function addMcp(): void {
    const result = addManualMcpBinding(form.mcps, mcpDraft)
    if (result.status === 'empty') {
      message.warning(t.editor.tools.mcpManualEmpty)
      return
    }
    if (result.status === 'duplicate') {
      message.info(t.editor.tools.mcpManualDuplicate(result.id))
      return
    }
    onChange({ mcps: result.mcps })
    setMcpDraft('')
    message.success(t.editor.tools.mcpManualAdded(result.id))
  }

  async function installSkillFromDirectory(): Promise<void> {
    const directoryPath = await window.platform.app.selectDirectory()
    if (!directoryPath) return
    await window.platform.agents.skills.installFromDirectory({ directoryPath })
  }

  async function installSkillFromZip(): Promise<void> {
    const paths = (await window.platform.app.selectFiles()) as string[]
    const zipFilePath = paths.find((path) => path.toLowerCase().endsWith('.zip'))
    if (!zipFilePath) return
    await window.platform.agents.skills.installFromZip({ zipFilePath })
  }

  const tabItems: Array<{
    value: string
    labelKey: string
    labelParams?: Record<string, string>
    children: React.ReactNode
  }> = [
          {
            value: 'tools',
            labelKey: 'editor.tools.builtinTab',
            labelParams: { enabled: String(enabledBuiltinToolCount), total: String(builtinTools.length) },
            children: (
              <BuiltinToolCatalog
                text={t}
                icon={<Wrench size={14} />}
                items={visibleBuiltinTools}
                disabledToolIds={disabledToolIds}
                onToggle={(id, checked) => {
                  if (checked) {
                    onChange({ disabledTools: form.disabledTools.filter((item) => item !== id) })
                    return
                  }
                  if (!disabledToolIds.has(id)) onChange({ disabledTools: [...form.disabledTools, id] })
                }}
              />
            )
          },
          {
            value: 'mcp',
            labelKey: 'editor.tools.mcpTab',
            labelParams: { count: String(form.mcps.length) },
            children: (
              <McpCatalog
                text={t}
                value={mcpDraft}
                catalog={mcpCatalog}
                toolsByServerId={state.mcpToolsByServerId}
                manualMcps={form.mcps.filter(
                  (mcpId) => !state.mcpServers.some((server) => server.id === mcpId) && matchesText(mcpId, search)
                )}
                onValueChange={setMcpDraft}
                onAdd={addMcp}
                onAddRegistered={(mcpId) => onChange({ mcps: [...form.mcps, mcpId] })}
                onRemove={(mcpId) => onChange({ mcps: form.mcps.filter((item) => item !== mcpId) })}
                onRefresh={(serverId) => void window.platform.agents.refreshMcpTools(serverId)}
              />
            )
          },
          {
            value: 'product-packages',
            labelKey: 'editor.tools.productPackagesTab',
            children: agentId ? (
              <ProductToolPackagesCatalog text={t} agentId={agentId} search={search} onClearSearch={() => setSearch('')} />
            ) : (
              <StateView
                state="disabled"
                reasonCode="precondition-unsaved"
                size="md"
                action={{ labelKey: STATE_VIEW_ACTION_KEYS.save, onSelect: onSave }}
              />
            )
          },
          {
            value: 'skills',
            labelKey: 'editor.tools.skillsTab',
            labelParams: { count: String(skillCatalog.filter((skill) => skill.enabledForAgent).length) },
            children: agentId ? (
              <SkillCatalog
                text={t}
                skills={skillCatalog}
                runtimeBySkillId={skillRuntimeBySkillId}
                onToggle={onSkillToggle}
                onInstallFromDirectory={installSkillFromDirectory}
                onInstallFromZip={installSkillFromZip}
                onRefresh={() => void window.platform.agents.skills.list(agentId ? { agentId } : undefined)}
                onUninstall={(skillId) => void window.platform.agents.skills.uninstall(skillId)}
                searchActive={search.trim().length > 0}
                onClearSearch={() => setSearch('')}
              />
            ) : (
              <StateView
                state="disabled"
                reasonCode="precondition-unsaved"
                size="md"
                action={{ labelKey: STATE_VIEW_ACTION_KEYS.save, onSelect: onSave }}
              />
            )
          }
        ]

  return (
    <div className="agent-form-section">
      <header>
        <h3>{t.editor.tools.title}</h3>
        <p>{t.editor.tools.description}</p>
      </header>

      <div className="agent-tool-search">
        <Search size={13} />
        <Input value={search} placeholder={t.editor.tools.searchPlaceholder} onChange={(event) => setSearch(event.target.value)} />
      </div>

      <Tabs
        ariaLabelKey="editor.tools.tabsLabel"
        items={tabItems.map(({ children: _panel, ...item }) => item)}
        onChange={(value) => setActiveTab(value as ToolTab)}
        panels={Object.fromEntries(tabItems.map((item) => [item.value, item.children]))}
        resolveText={(key) => resolveAgentTextKey(t, key)}
        value={activeTab}
      />
    </div>
  )
}
