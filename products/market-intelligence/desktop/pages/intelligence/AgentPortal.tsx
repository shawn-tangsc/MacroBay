import { Bitcoin, CandlestickChart, ChartLine } from 'lucide-react'

import type { ActivationProjection } from './agentActivationPolicy'
import type { MarketIntelligenceAgent } from './agentPortalModel'
import cryptoPortraitUrl from './assets/mi-crypto-analyst.jpg'
import equitiesPortraitUrl from './assets/mi-equities-analyst.jpg'
import futuresPortraitUrl from './assets/mi-futures-analyst.jpg'

type AgentPortalText = {
  moduleLabel: string
  agents: Record<MarketIntelligenceAgent['id'], { name: string; lens: string; sourceSummary: string }>
  states: { available: string; comingSoon: string }
  sourceSummary: { count: string; pending: string }
  actions: { activate: string; openDashboard: string; unavailable: string }
  activation: {
    progress: string
    actions: { configure: string; sampleSwitch: string }
    previewHint: string
  }
}

const agentIcons = {
  bitcoin: Bitcoin,
  'chart-line': ChartLine,
  candlestick: CandlestickChart
} as const

const portraitUrls = {
  'mi-crypto-analyst.jpg': cryptoPortraitUrl,
  'mi-equities-analyst.jpg': equitiesPortraitUrl,
  'mi-futures-analyst.jpg': futuresPortraitUrl
} as const

type AgentPortalProps = {
  agents: MarketIntelligenceAgent[]
  text: AgentPortalText
  sourceCounts?: Partial<Record<MarketIntelligenceAgent['id'], number>>
  activation: ActivationProjection
  sample: Readonly<{
    active: boolean
    available: boolean
    busy: boolean
  }>
  onPrimary: () => void
  onOpenSources: () => void
  onToggleSample: () => void
}

export function AgentPortal({
  activation,
  agents,
  onOpenSources,
  onPrimary,
  onToggleSample,
  sample,
  sourceCounts,
  text
}: AgentPortalProps): React.ReactElement {
  return (
    <section className="intelligence-page mi-agent-portal" aria-label={text.moduleLabel}>
      <div className="mi-agent-portal__content">
        <p className="mi-agent-portal__label">{text.moduleLabel}</p>
        <div className="mi-agent-portal__grid">
          {agents.map((agent) => {
            const Icon = agentIcons[agent.icon]
            const isAvailable = agent.activation === 'available'
            const isCrypto = agent.id === 'crypto'
            const status = isAvailable ? text.states.available : text.states.comingSoon
            const copy = text.agents[agent.id]
            const sourceCount = sourceCounts?.[agent.id] ?? 0
            const sourceSummary = sourceCount > 0
              ? text.sourceSummary.count.replace('{count}', String(sourceCount))
              : text.sourceSummary.pending
            const progress = text.activation.progress
              .replace('{enabled}', String(activation.enabledSourceCount))
              .replace('{total}', String(activation.totalSourceCount))
            const sampleSwitchDisabled = sample.busy || (!sample.available && !sample.active)

            return (
              <article className={`mi-agent-card${isAvailable ? '' : ' is-disabled'}`} data-agent-id={agent.id} data-agent-state={isCrypto && sample.active ? 'sample' : (isAvailable ? 'available' : 'coming-soon')} key={agent.id}>
                <span className="mi-agent-card__copy">
                  <span className="mi-agent-card__top">
                    {isCrypto ? (
                      <button
                        aria-checked={sample.active}
                        aria-label={text.activation.actions.sampleSwitch}
                        className={`mi-agent-card__switch${sample.active ? ' is-on' : ''}`}
                        disabled={sampleSwitchDisabled}
                        onClick={(event) => {
                          event.stopPropagation()
                          onToggleSample()
                        }}
                        role="switch"
                        title={text.activation.previewHint}
                        type="button"
                      >
                        <span aria-hidden="true" className="mi-agent-card__switch-track">
                          <span className="mi-agent-card__switch-thumb" />
                        </span>
                        <span>{text.activation.actions.sampleSwitch}</span>
                      </button>
                    ) : (
                      <span className="mi-agent-card__status">
                        <Icon aria-hidden="true" size={13} strokeWidth={1.8} />
                        {status}
                      </span>
                    )}
                    {isCrypto ? (
                      <button
                        aria-label={`${text.activation.actions.configure} · ${progress}`}
                        className="mi-agent-card__progress"
                        onClick={(event) => {
                          event.stopPropagation()
                          onOpenSources()
                        }}
                        type="button"
                      >
                        {progress}
                      </button>
                    ) : null}
                  </span>
                  <span className="mi-agent-card__identity">
                    <span className="mi-agent-card__name">{copy.name}</span>
                    <span className="mi-agent-card__lens">{copy.lens}</span>
                  </span>
                  <span className="mi-agent-card__footer">
                    <span>{sourceSummary}</span>
                    <strong>{isAvailable ? text.actions.openDashboard : text.actions.unavailable}</strong>
                  </span>
                </span>
                <span className="mi-agent-card__portrait">
                  <img alt="" aria-hidden="true" draggable={false} src={portraitUrls[agent.portraitAsset]} />
                </span>
                <button
                  aria-label={isAvailable ? text.actions.openDashboard : text.states.comingSoon}
                  className="mi-agent-card__entry"
                  disabled={!isAvailable}
                  onClick={isAvailable ? onPrimary : undefined}
                  type="button"
                />
              </article>
            )
          })}
        </div>
      </div>
    </section>
  )
}
