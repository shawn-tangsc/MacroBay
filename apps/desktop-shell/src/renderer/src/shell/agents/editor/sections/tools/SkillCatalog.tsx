import { useState } from 'react'
import { Button, Switch, Tag } from 'antd'
import { Archive, Eye, FolderPlus, RefreshCw, Sparkles, Store, Trash2 } from 'lucide-react'

import { buildAgentSkillCatalog } from '@platform/ai/agent-platform/skills/agentSkillViewModel'
import type { AgentSkillRuntimeCatalogEntry } from '@platform/ai/agent-platform/skills/skillRuntimeSchemas'

import type { AgentText } from '../../../agentText'
import SkillDetailModal from '../../SkillDetailModal'
import SkillMarketplaceModal from '../../SkillMarketplaceModal'
import { buildAgentSkillRuntimeViewModel } from '../../agentSkillRuntimeViewModel'
import { EmptyCatalog } from './EmptyCatalog'

type SkillCatalogProps = {
  text: AgentText
  skills: ReturnType<typeof buildAgentSkillCatalog>
  runtimeBySkillId: ReadonlyMap<string, AgentSkillRuntimeCatalogEntry>
  onToggle: (skillId: string, checked: boolean) => void | Promise<void>
  onInstallFromDirectory: () => void
  onInstallFromZip: () => void
  onRefresh: () => void
  onUninstall: (skillId: string) => void
}

export function SkillCatalog({
  text,
  skills,
  runtimeBySkillId,
  onToggle,
  onInstallFromDirectory,
  onInstallFromZip,
  onRefresh,
  onUninstall
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
        <EmptyCatalog
          icon={<Sparkles size={17} />}
          title={text.editor.tools.noSkillTitle}
          description={text.editor.tools.noSkillDescription}
        />
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
          <Tag className="agent-tool-approval">{skill.source}</Tag>
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
