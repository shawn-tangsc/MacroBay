import { Bitcoin, CandlestickChart, ChartLine } from 'lucide-react'

import type { ActivationState } from './agentActivationPolicy'
import type { MarketIntelligenceAgent } from './agentPortalModel'
import cryptoPortraitUrl from './assets/mi-crypto-analyst.jpg'
import equitiesPortraitUrl from './assets/mi-equities-analyst.jpg'
import futuresPortraitUrl from './assets/mi-futures-analyst.jpg'

type AgentPortalText = {
  moduleLabel: string
  /**
   * 三种「没有可用读数」的唯一用词，各有自己的下一步：
   * 没配置 → 去设置配置、都没启用 → 去启用、读不到 → 再试一次。三句不许互相借。
   */
  data: {
    temporarilyUnavailable: string
    retry: string
    sourcesNotConfigured: string
    sourcesNotEnabled: string
    configureSources: string
    enableSources: string
  }
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
  activation: ActivationState
  /** The failed-read retry: it must ask again, not just clear the error. */
  onRetryActivation: () => void
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
  onRetryActivation,
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
            const progress = activation.status === 'ready'
              ? text.activation.progress
                .replace('{enabled}', String(activation.enabledSourceCount))
                .replace('{total}', String(activation.totalSourceCount))
              : ''
            // Four answers, four different next steps. A failed read must never borrow a
            // not-configured sentence, and "nothing configured" must not absorb "configured but
            // all switched off" — the reader's next move differs in each case. A 0/12 read is
            // still unanswered setup; printing it as a fraction reads like a working counter.
            const activationState = activation.status === 'loading' ? 'loading'
              : activation.status === 'unavailable' ? 'unavailable'
                : activation.totalSourceCount === 0 ? 'not-configured'
                  : activation.enabledSourceCount === 0 ? 'not-enabled'
                    : 'configured'
            const activationText = activationState === 'unavailable' ? text.data.temporarilyUnavailable
              : activationState === 'not-configured' ? text.data.sourcesNotConfigured
                : activationState === 'not-enabled' ? text.data.sourcesNotEnabled
                  : '—'
            const activationAction = activationState === 'unavailable'
              ? { label: text.data.retry, run: onRetryActivation }
              : activationState === 'not-configured'
                ? { label: text.data.configureSources, run: onOpenSources }
                : activationState === 'not-enabled'
                  ? { label: text.data.enableSources, run: onOpenSources }
                  : undefined
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
                      activationState === 'configured' ? (
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
                      ) : (
                        <span className="mi-agent-card__activation" data-activation-state={activationState}>
                          <span className="mi-agent-card__activation-state">{activationText}</span>
                          {activationAction ? (
                            <button
                              className="mi-agent-card__activation-action"
                              onClick={(event) => {
                                event.stopPropagation()
                                activationAction.run()
                              }}
                              type="button"
                            >
                              {activationAction.label}
                            </button>
                          ) : null}
                        </span>
                      )
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
