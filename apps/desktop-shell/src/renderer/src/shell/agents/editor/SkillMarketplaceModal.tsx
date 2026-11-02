import { useMemo, useState } from 'react'
import { Button, Input, Tag } from 'antd'
import { Check, Download, ExternalLink, Search, Sparkles } from 'lucide-react'

import type { InstalledSkill, SkillSearchResult } from '@platform/ai/agent-platform/schemas/skillSchemas'
import { Modal } from '@platform/ui/components/modal'
import { StateView } from '@platform/ui/components/state'
import { STATE_VIEW_ACTION_KEYS } from '@platform/ui/components/state/stateViewText'
import { StatusPill } from '@platform/ui/components/status-pill'

import type { useAgentText } from '../agentTextProvider'
import { resolveAgentTextKey } from '../agentTooltipText'
import { buildSkillMarketplaceRows } from './skillMarketplaceViewModel'

const MARKETPLACE_TITLE_KEY = 'editor.tools.marketplaceTitle'

/** 来源注册表名是分类名词。 */
const REGISTRY_KEY = 'agent.skills.registry'

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
      width="expanded"
      titleKey={MARKETPLACE_TITLE_KEY}
      resolveText={(key) => resolveAgentTextKey(text, key)}
      className="agent-skill-marketplace-modal"
      onClose={onClose}>
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
            query.trim() ? (
              <StateView
                state="empty"
                reasonCode="filtered-out"
                size="md"
                action={{
                  labelKey: STATE_VIEW_ACTION_KEYS.clear_filter,
                  onSelect: () => {
                    setQuery('')
                    setResults([])
                  }
                }}
              />
            ) : (
              <StateView state="empty" reasonCode="not-yet" size="md" />
            )
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
                  <StatusPill
                    tone="ok"
                    labelKey="editor.tools.skillInstalled"
                    resolveText={(key) => resolveAgentTextKey(text, key)}
                  />
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
