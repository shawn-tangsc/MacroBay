import { useState } from 'react'
import { Button, Switch, Tag } from 'antd'
import { Archive, Eye, FolderPlus, RefreshCw, Sparkles, Store, Trash2 } from 'lucide-react'

import { buildAgentSkillCatalog } from '@platform/ai/agent-platform/skills/agentSkillViewModel'
import type { AgentSkillRuntimeCatalogEntry } from '@platform/ai/agent-platform/skills/skillRuntimeSchemas'

import type { AgentText } from '../../../agentText'
import SkillDetailModal from '../../SkillDetailModal'
import SkillMarketplaceModal from '../../SkillMarketplaceModal'
import { buildAgentSkillRuntimeViewModel } from '../../agentSkillRuntimeViewModel'
import { MetaChip } from '@platform/ui/components/meta-chip'
import { StateView } from '@platform/ui/components/state'
import { STATE_VIEW_ACTION_KEYS } from '@platform/ui/components/state/stateViewText'

/** `kind="text"` 档从不查表——这些是数据，不是句子；签名要求一个解析器，给个空实现。 */
const noopText = (): string => ''

type SkillCatalogProps = {
  text: AgentText
  skills: ReturnType<typeof buildAgentSkillCatalog>
  runtimeBySkillId: ReadonlyMap<string, AgentSkillRuntimeCatalogEntry>
  onToggle: (skillId: string, checked: boolean) => void | Promise<void>
  onInstallFromDirectory: () => void
  onInstallFromZip: () => void
  onRefresh: () => void
  onUninstall: (skillId: string) => void
  /** 列表为空时区分「搜不到」与「一个都没装」：前者给人清筛选的动作，后者给人安装入口。 */
  searchActive: boolean
  onClearSearch: () => void
}

/** 技能来源是分类名词。 */
const SKILL_SOURCE_KEY = 'agent.skills.source'

export function SkillCatalog({
  text,
  skills,
  runtimeBySkillId,
  onToggle,
  onInstallFromDirectory,
  onInstallFromZip,
  onRefresh,
  onUninstall,
  searchActive,
  onClearSearch
}: SkillCatalogProps): React.ReactElement {
  const [marketplaceOpen, setMarketplaceOpen] = useState(false)
  const [detailSkillId, setDetailSkillId] = useState<string | null>(null)
  const detailSkill = skills.find((skill) => skill.id === detailSkillId) ?? null
  const actions = (
    <div className="agent-skill-actions">
      <Button className="ant-primary-button" size="small" icon={<Store size={13} />} onClick={() => setMarketplaceOpen(true)}>
        {text.editor.tools.openSkillMarketplace}
      </Button>
      <Button className="ant-secondary-button" size="small" icon={<Archive size={13} />} onClick={() => void onInstallFromZip()}>
        {text.editor.tools.installSkillFromZip}
      </Button>
      <Button
        className="ant-secondary-button"
        size="small"
        icon={<FolderPlus size={13} />}
        onClick={() => void onInstallFromDirectory()}>
        {text.editor.tools.installSkillFromDirectory}
      </Button>
      <Button
        className="ant-icon-button"
        size="small"
        icon={<RefreshCw size={13} />}
        title={text.editor.tools.refreshSkills}
        aria-label={text.editor.tools.refreshSkills}
        onClick={() => void onRefresh()}
      />
    </div>
  )

  return (
    <div className="agent-tool-catalog">
      {actions}
      <SkillMarketplaceModal
        open={marketplaceOpen}
        text={text}
        installedSkills={skills}
        onClose={() => setMarketplaceOpen(false)}
      />
      <SkillDetailModal
        open={Boolean(detailSkill)}
        text={text}
        skill={detailSkill}
        runtimeEntry={detailSkill ? runtimeBySkillId.get(detailSkill.id) ?? null : null}
        onClose={() => setDetailSkillId(null)}
      />
      {skills.length === 0 ? (
        searchActive ? (
          <StateView
            state="empty"
            reasonCode="filtered-out"
            size="md"
            action={{ labelKey: STATE_VIEW_ACTION_KEYS.clear_filter, onSelect: onClearSearch }}
          />
        ) : (
          <StateView
            state="empty"
            reasonCode="none-installed"
            size="md"
            action={{ labelKey: STATE_VIEW_ACTION_KEYS.install, onSelect: () => setMarketplaceOpen(true) }}
          />
        )
      ) : (
        skills.map((skill) => (
          <SkillCatalogRow
            key={skill.id}
            skill={skill}
            text={text}
            runtimeEntry={runtimeBySkillId.get(skill.id) ?? null}
            onToggle={onToggle}
            onOpenDetail={() => setDetailSkillId(skill.id)}
            onUninstall={onUninstall}
          />
        ))
      )}
    </div>
  )
}

type SkillCatalogRowProps = {
  skill: ReturnType<typeof buildAgentSkillCatalog>[number]
  text: AgentText
  runtimeEntry: AgentSkillRuntimeCatalogEntry | null
  onToggle: (skillId: string, checked: boolean) => void | Promise<void>
  onOpenDetail: () => void
  onUninstall: (skillId: string) => void
}

function SkillCatalogRow({
  skill,
  text,
  runtimeEntry,
  onToggle,
  onOpenDetail,
  onUninstall
}: SkillCatalogRowProps): React.ReactElement {
  const runtimeView = buildAgentSkillRuntimeViewModel(runtimeEntry)
  const statusNote =
    runtimeView.statusKind === 'unavailable'
      ? text.editor.tools.skillRuntimeUnavailable
      : runtimeView.statusKind === 'empty'
        ? text.editor.tools.skillRuntimeEmptySummary
        : null

  return (
    <div className="agent-tool-row">
      <span className="agent-tool-icon">
        <Sparkles size={14} />
      </span>
      <span className="agent-tool-copy">
        <strong>{skill.name}</strong>
        <small>{runtimeView.primarySummary ?? skill.description ?? skill.folderName}</small>
        <span className="agent-marketplace-meta">
          <MetaChip kind="text" text={skill.source} resolveText={noopText} />
          {runtimeView.toolCount > 0 ? <span>{text.editor.tools.skillRuntimeToolCount(runtimeView.toolCount)}</span> : null}
          {runtimeView.capabilityCount > 0 ? (
            <span>{text.editor.tools.skillRuntimeCapabilityCount(runtimeView.capabilityCount)}</span>
          ) : null}
        </span>
        {statusNote ? <small className={`agent-skill-status-note${runtimeView.statusKind === 'unavailable' ? ' warn' : ''}`}>{statusNote}</small> : null}
        {runtimeView.statusKind !== 'ready' ? (
          <small className="agent-skill-status-note">{text.editor.tools.skillCredentialHint}</small>
        ) : null}
      </span>
      <Switch size="small" checked={skill.enabledForAgent} onChange={(checked) => void onToggle(skill.id, checked)} />
      <Button
        className="ant-icon-button"
        size="small"
        icon={<Eye size={13} />}
        title={text.editor.tools.viewSkillDetail}
        aria-label={text.editor.tools.viewSkillDetail}
        onClick={onOpenDetail}
      />
      {skill.source !== 'builtin' ? (
        <Button
          className="ant-icon-button"
          size="small"
          icon={<Trash2 size={13} />}
          title={text.editor.tools.uninstallSkill}
          aria-label={text.editor.tools.uninstallSkill}
          onClick={() => void onUninstall(skill.id)}
        />
      ) : null}
    </div>
  )
}
