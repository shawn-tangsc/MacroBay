import { useMemo, useState } from 'react'
import { Button, Input, Modal, Tag } from 'antd'
import { Check, Download, ExternalLink, Search, Sparkles } from 'lucide-react'

import type { InstalledSkill, SkillSearchResult } from '@platform/ai/agent-platform/schemas/skillSchemas'

import type { useAgentText } from '../agentTextProvider'
import { buildSkillMarketplaceRows } from './skillMarketplaceViewModel'

type SkillMarketplaceModalProps = {
  open: boolean
  text: ReturnType<typeof useAgentText>
  installedSkills: readonly InstalledSkill[]
  onClose: () => void
}

export default function SkillMarketplaceModal({
  open,
  text,
  installedSkills,
  onClose
}: SkillMarketplaceModalProps): React.ReactElement {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SkillSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [installingSource, setInstallingSource] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const rows = useMemo(() => buildSkillMarketplaceRows(results, installedSkills), [installedSkills, results])

  async function searchSkills(): Promise<void> {
    const keyword = query.trim()
    if (!keyword) {
      setResults([])
      return
    }

    setSearching(true)
    setError(null)
    try {
      setResults((await window.platform.agents.skills.search(keyword)) as SkillSearchResult[])
    } catch (searchError) {
      setError(errorMessage(searchError))
    } finally {
      setSearching(false)
    }
  }

  async function installSkill(row: SkillSearchResult): Promise<void> {
    setInstallingSource(row.installSource)
    setError(null)
    try {
      await window.platform.agents.skills.install({ installSource: row.installSource })
    } catch (installError) {
      setError(errorMessage(installError))
    } finally {
      setInstallingSource(null)
    }
  }

  return (
    <Modal
      open={open}
      width={720}
      footer={null}
      title={text.editor.tools.marketplaceTitle}
      className="agent-skill-marketplace-modal"
      onCancel={onClose}>
      <div className="agent-skill-marketplace">
        <div className="agent-skill-marketplace-search">
          <Search size={14} />
          <Input
            autoFocus
            value={query}
            placeholder={text.editor.tools.marketplaceSearchPlaceholder}
            onChange={(event) => setQuery(event.target.value)}
            onPressEnter={() => void searchSkills()}
          />
          <Button className="ant-primary-button" size="small" loading={searching} onClick={() => void searchSkills()}>
            {text.editor.tools.searchMarketplace}
          </Button>
        </div>

        {error ? <div className="agent-skill-marketplace-error">{error}</div> : null}

        <div className="agent-skill-marketplace-list">
          {rows.length === 0 ? (
            <div className="agent-empty-catalog compact">
              <Sparkles size={17} />
              <strong>{text.editor.tools.marketplaceEmptyTitle}</strong>
              <span>{text.editor.tools.marketplaceEmptyDescription}</span>
            </div>
          ) : (
            rows.map((row) => (
              <div key={`${row.sourceRegistry}:${row.slug}`} className="agent-marketplace-skill-row">
                <span className="agent-tool-icon">
                  <Sparkles size={14} />
                </span>
                <span className="agent-tool-copy">
                  <strong>{row.name}</strong>
                  <small>{row.description ?? text.common.noDescription}</small>
                  <span className="agent-marketplace-meta">
                    <Tag className="agent-tool-approval">{row.sourceRegistry}</Tag>
                    <span>{row.statsText}</span>
                    {row.author ? <span>{row.author}</span> : null}
                  </span>
                </span>
                {row.sourceUrl ? (
                  <Button
                    className="ant-icon-button"
                    size="small"
                    icon={<ExternalLink size={13} />}
                    title={text.editor.tools.openSkillSource}
                    aria-label={text.editor.tools.openSkillSource}
                    onClick={() => void window.platform.app.openExternal(row.sourceUrl!)}
                  />
                ) : null}
                {row.isInstalled ? (
                  <Tag className="agent-tool-approval auto">
                    <Check size={12} />
                    {text.editor.tools.skillInstalled}
                  </Tag>
                ) : (
                  <Button
                    className="ant-secondary-button"
                    size="small"
                    icon={<Download size={13} />}
                    loading={installingSource === row.installSource}
                    onClick={() => void installSkill(row)}>
                    {text.editor.tools.installSkill}
                  </Button>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </Modal>
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? 'Unknown error')
}
