import { Button, Drawer } from 'antd'
import { CircleDot } from 'lucide-react'

import '../../settings/intelligence-sources/intelligence-sources.css'
import type { ActivationSourceTier, MarketIntelligenceActivationSource } from './agentPortalModel'

type SourceCopy = { name: string; description: string }

type AgentActivationDrawerText = {
  title: string
  subtitle: string
  tiers: Record<ActivationSourceTier, string>
  sources: Record<string, SourceCopy>
  detailTitle: string
  detailFallback: string
  sourceListTitle: string
  sourceListStatus: string
  sourceDetails: Record<string, { scope: string; adapter: string; endpoint: string; cadence: string }>
  detailFields: { scope: string; adapter: string; endpoint: string; cadence: string; status: string }
  unverified: string
  activate: string
}

type ActivationSourceView = { sourceId: string; displayName: string; enabled: boolean; visibility: string }
type ActivationGroupView = { groupId: string; tier: ActivationSourceTier; sources: ActivationSourceView[] }

type AgentActivationDrawerProps = {
  open: boolean
  groups?: ActivationGroupView[]
  onEnableRequired?: () => Promise<void>
  sources: MarketIntelligenceActivationSource[]
  text: AgentActivationDrawerText
  onClose: () => void
}

const sourceTiers: ActivationSourceTier[] = ['required', 'recommended', 'optional']
const drawerWidth = 'min(1080px, max(360px, calc(100vw - 48px)), calc(100vw - 24px))'

export function AgentActivationDrawer({
  groups,
  onEnableRequired,
  open,
  sources,
  text,
  onClose
}: AgentActivationDrawerProps): React.ReactElement {
  const selectedSource = sources[0]
  const selectedCopy = selectedSource ? text.sources[selectedSource.id] : undefined

  return (
    <Drawer
      className="mi-agent-drawer"
      closable
      destroyOnHidden
      footer={(
        <div className="mi-agent-drawer__footer">
          <Button disabled={!groups || !onEnableRequired} type="primary" onClick={() => void onEnableRequired?.()}>
            {text.activate}
          </Button>
        </div>
      )}
      onClose={onClose}
      open={open}
      placement="right"
      title={text.title}
      width={drawerWidth}
    >
      <div className="settings-workspace intelligence-sources-workspace mi-agent-drawer__workspace mi-agent-drawer__split">
        <aside className="intelligence-catalog-pane" aria-label={text.sourceListTitle}>
          <div className="intelligence-catalog-titlebar">
            <span>{text.sourceListTitle}</span>
            <div className="intelligence-titlebar-actions">
              <small>{text.sourceListStatus}</small>
            </div>
          </div>
          <div className="intelligence-catalog-list">
            {groups ? groups.map((group) => (
              <section className="intelligence-catalog-group" key={group.groupId}>
                <div className="intelligence-catalog-group-title">{text.tiers[group.tier]} · {group.sources.filter((source) => source.enabled).length}/{group.sources.length}</div>
                {group.sources.map((source) => (
                  <div className="intelligence-catalog-item" key={source.sourceId}>
                    <span className="intelligence-source-avatar" aria-hidden="true">{source.displayName.slice(0, 1)}</span>
                    <span className="intelligence-catalog-item-copy">
                      <strong>{source.displayName}</strong>
                      <small>{source.visibility === 'pending' ? text.tiers[group.tier] + ' · ' + text.unverified : text.tiers[group.tier]}</small>
                    </span>
                    <span className={`intelligence-catalog-item-status${source.enabled ? ' enabled' : ''}`} aria-hidden="true" />
                  </div>
                ))}
              </section>
            )) : sourceTiers.map((tier) => (
              <section className="intelligence-catalog-group" key={tier}>
                <div className="intelligence-catalog-group-title">{text.tiers[tier]}</div>
                {sources.filter((source) => source.tier === tier).map((source) => {
                  const copy = text.sources[source.id]
                  const selected = source.id === selectedSource?.id
                  return (
                    <div className={`intelligence-catalog-item${selected ? ' selected' : ''}`} key={source.id}>
                      <span className="intelligence-source-avatar" aria-hidden="true">
                        {copy.name.slice(0, 1)}
                      </span>
                      <span className="intelligence-catalog-item-copy">
                        <strong>{copy.name}</strong>
                        <small>{text.tiers[source.tier]}</small>
                      </span>
                      <span className="intelligence-catalog-item-status enabled" aria-hidden="true">
                        <CircleDot size={13} strokeWidth={1.8} />
                      </span>
                    </div>
                  )
                })}
              </section>
            ))}
          </div>
        </aside>
        <section className="settings-detail-pane intelligence-detail-pane" aria-live="polite">
          <div className="intelligence-source-titlebar">
            <span>{text.detailTitle}</span>
            <div className="intelligence-titlebar-actions">
              <small>{text.unverified}</small>
            </div>
          </div>
          <div className="intelligence-detail-scroll">
            <div className="intelligence-source-detail-content">
              <section className="intelligence-overview-panel">
                <div className="intelligence-source-header">
                  <span className="intelligence-source-avatar" data-size="large" aria-hidden="true">
                    {selectedCopy?.name.slice(0, 1) ?? ''}
                  </span>
                  <div className="intelligence-source-header-copy">
                    <strong>{selectedCopy?.name ?? text.detailFallback}</strong>
                    <div className="intelligence-source-header-meta">
                      <span className="intelligence-source-meta-pill">{selectedCopy?.description ?? text.detailFallback}</span>
                    </div>
                  </div>
                </div>
                {selectedSource && selectedCopy ? (
                  <section className="intelligence-section">
                    <div className="intelligence-section-header">
                      <span className="intelligence-section-title">{text.detailTitle}</span>
                      <span className="intelligence-section-status">{text.detailFields.status}</span>
                    </div>
                    <div className="intelligence-setting-grid">
                      <div className="intelligence-setting-row">
                        <span className="intelligence-setting-label">{text.detailFields.scope}</span>
                        <span className="intelligence-setting-control">
                          <span className="intelligence-source-meta-pill mi-agent-drawer__static-value">{text.sourceDetails[selectedSource.id]?.scope}</span>
                        </span>
                      </div>
                      <div className="intelligence-setting-row">
                        <span className="intelligence-setting-label">{text.detailFields.adapter}</span>
                        <span className="intelligence-setting-control">
                          <span className="intelligence-source-meta-pill mi-agent-drawer__static-value">{text.sourceDetails[selectedSource.id]?.adapter}</span>
                        </span>
                      </div>
                      <div className="intelligence-setting-row">
                        <span className="intelligence-setting-label">{text.detailFields.endpoint}</span>
                        <span className="intelligence-setting-control">
                          <span className="intelligence-source-meta-pill mi-agent-drawer__static-value">{text.sourceDetails[selectedSource.id]?.endpoint}</span>
                        </span>
                      </div>
                      <div className="intelligence-setting-row">
                        <span className="intelligence-setting-label">{text.detailFields.cadence}</span>
                        <span className="intelligence-setting-control">
                          <span className="intelligence-source-meta-pill mi-agent-drawer__static-value">{text.sourceDetails[selectedSource.id]?.cadence}</span>
                        </span>
                      </div>
                    </div>
                  </section>
                ) : null}
              </section>
            </div>
          </div>
        </section>
      </div>
    </Drawer>
  )
}
