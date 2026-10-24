import { localizeAnalysisMagnitudeUnits, type MarketAnalysisReadableLocale, type MarketAnalysisReadableNames } from '../../../contracts/marketAnalysisReadableText'
import type { MarketAnalysisTimelineDetail } from '../../shared/ipc/marketAnalysisTimelineClient'
import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'
import { conclusionReadableNames } from './analysisConclusionVocabulary'
import { formatChangeEntries, type MarketAnalysisChangeEntry } from './marketAnalysisChangeFormat'
import { readConclusion } from './analysisConclusionBlocks'
import { AnalysisDirectionsBlock, type AnalysisDirectionsText } from './AnalysisDirectionsBlock'
import { analysisConclusionDirectionPolicy, type AnalysisConclusionDirection } from './analysisConclusionDirectionPolicy'

export type AnalysisDetailText = Readonly<{
  /** Panel heading used by the node detail drawer. */
  detail: string
  /** Shared loading copy for the detail surfaces. */
  loading: string
  conclusion: string
  /** Label for the frozen "what changed" block. */
  changeSummary: string
  /** Heading for the per-domain change list. */
  changeFacts: string
  /** Shown when the run moved the missing-domain, caveat or evidence sets instead of a value. */
  changeStructural: string
  changeDomainAdded: string
  changeDomainRemoved: string
  changeCaveatAdded: string
  changeCaveatRemoved: string
  changeEvidenceAdded: string
  changeEvidenceRemoved: string
  changeObservationsAdded: string
  changeObservationsRemoved: string
  /** Shown when this snapshot carries no movement against its predecessor. */
  noChange: string
  /** Section titles for the labelled parts of the conclusion body. */
  conclusionBlocks: Readonly<Record<string, string>>
  /** Localized labels for the controlled direction vocabulary. */
  conclusionDirection: Readonly<{ label: string } & Record<AnalysisConclusionDirection, string>>
  /** The operation-direction block: one row per horizon, absent on summaries published before it. */
  directions: AnalysisDirectionsText
  confirmedFacts: string
  transmission: string
  marketReaction: string
  noMarketReaction: string
  supportingEvidence: string
  counterEvidence: string
  catalysts: string
  auditInfo: string
  prediction: string
  noPrediction: string
  conditions: string
  invalidation: string
  verificationDue: string
  dataCutoff: string
  eventGroup: string
  analysisRun: string
  summaryVersion: string
  evidenceCount: string
  asOf: string
  status: Record<string, string>
  /**
   * Reader-facing names for the analysis identifiers, owned by the product i18n registry.
   * The model prompt keeps its own Chinese vocabulary, so both the published conclusion and
   * the frozen change record are named from this one map on screen.
   */
  readableNames: MarketAnalysisReadableNames
  /** Locale for number formatting; the conclusion prose is Chinese, so this defaults to it. */
  readableLocale?: MarketAnalysisReadableLocale
}>

/**
 * Read-only detail body shared by the latest-conclusion card and the node
 * detail drawer. The AI conclusion is rendered first and in full: it is the
 * published conclusion, not a preview, so nothing here may shorten it.
 * Audit identifiers stay inside a collapsed details element.
 */
export function AnalysisConclusionDetail({ detail, text }: Readonly<{ detail: MarketAnalysisTimelineDetail; text: AnalysisDetailText }>): React.ReactElement {
  const formatTime = useShellTimeFormat()
  const summary = detail.summary
  const locale = text.readableLocale ?? 'zh-CN'
  // Two contract generations: a structured conclusion (current) or the legacy labelled paragraph,
  // read through the same projection the at-a-glance card uses.
  const { direction, blocks } = readConclusion(summary, conclusionReadableNames, locale)
  const localizedBlocks = blocks.map(block => ({ ...block, text: localizeAnalysisMagnitudeUnits(block.text, locale) }))
  return <div className="mi-analysis-timeline__detail-content">
    <section className="mi-analysis-timeline__conclusion" data-direction={direction ?? 'none'}
      style={direction ? { '--mi-conclusion-direction': `var(${analysisConclusionDirectionPolicy.colorTokens[direction]})` } as React.CSSProperties : undefined}>
      <header className="mi-analysis-conclusion__head">
        <p className="mi-analysis-timeline__section-label">{text.conclusion}</p>
        {direction ? <span className="mi-analysis-conclusion__direction" role="note" aria-label={`${text.conclusionDirection.label}：${text.conclusionDirection[direction]}`}>{text.conclusionDirection[direction]}</span> : null}
      </header>
      {(detail.summary.directions ?? []).length > 0 ? <AnalysisDirectionsBlock directions={detail.summary.directions!} text={text.directions} /> : null}
      <div className="mi-analysis-conclusion__body">
        {localizedBlocks.map((block, index) => block.kind === 'text'
          ? <p className="mi-analysis-conclusion__text" key={`text-${index}`}>{block.text}</p>
          : <div className="mi-analysis-conclusion__block" data-block={block.kind} key={`${block.kind}-${index}`}>
            <span className="mi-analysis-conclusion__block-title">{text.conclusionBlocks[block.kind] ?? block.kind}</span>
            <p>{block.text}</p>
          </div>)}
      </div>
    </section>
    <ChangeSection change={detail.run.change} text={text} />
    <ClaimSection title={text.confirmedFacts} claims={detail.summary.knownFacts} locale={locale} />
    <ClaimSection title={text.transmission} claims={detail.summary.transmissionHypotheses} locale={locale} />
    <ClaimSection title={text.marketReaction} claims={detail.summary.marketReaction} empty={text.noMarketReaction} locale={locale} />
    <ClaimSection title={text.supportingEvidence} claims={detail.summary.supportingEvidence} locale={locale} />
    <ClaimSection title={text.counterEvidence} claims={detail.summary.counterEvidence} locale={locale} />
    <section><h3>{text.prediction}</h3>{detail.predictions.length === 0 ? <p className="mi-analysis-timeline__state">{text.noPrediction}</p> : detail.predictions.map((prediction) => <div className="mi-analysis-timeline__prediction" key={prediction.id}><div><strong>{prediction.asset} · {localizeAnalysisMagnitudeUnits(prediction.baseCase, locale)}</strong><em>{text.status[prediction.status]}</em></div><p>{text.conditions}：{prediction.conditions.map(condition => localizeAnalysisMagnitudeUnits(condition, locale)).join('；')}</p><p>{text.invalidation}：{localizeAnalysisMagnitudeUnits(prediction.invalidation, locale)}</p><small>{text.verificationDue}：{formatTime(prediction.verificationDueAt, 'second')}</small></div>)}</section>
    <ClaimSection title={text.catalysts} claims={detail.summary.nextCatalysts} locale={locale} />
    <section><h3>{text.dataCutoff}</h3>{detail.summary.dataCaveats.map((caveat) => <p className="mi-analysis-timeline__caveat" key={caveat}>{localizeAnalysisMagnitudeUnits(caveat, locale)}</p>)}</section>
    <details className="mi-analysis-timeline__audit"><summary>{text.auditInfo}</summary><dl><div><dt>{text.eventGroup}</dt><dd>{detail.run.eventGroupId}</dd></div><div><dt>{text.analysisRun}</dt><dd>{detail.run.id}</dd></div><div><dt>{text.summaryVersion}</dt><dd>{detail.summary.version}</dd></div><div><dt>{text.evidenceCount}</dt><dd>{detail.run.evidenceCount}</dd></div><div><dt>{text.asOf}</dt><dd>{formatTime(detail.run.asOf, 'second')}</dd></div><div><dt>{text.dataCutoff}</dt><dd>{formatTime(detail.run.dataCutoff, 'second')}</dd></div></dl></details>
  </div>
}

function ClaimSection({ title, claims, empty, locale }: Readonly<{ title: string; claims: readonly Readonly<{ statement: string }>[]; empty?: string; locale: MarketAnalysisReadableLocale }>): React.ReactElement | null {
  if (!claims.length && !empty) return null
  return <section className="mi-analysis-timeline__claims"><h3>{title}</h3>{claims.length ? <ul>{claims.map((claim, index) => <li key={`${claim.statement}-${index}`}>{localizeAnalysisMagnitudeUnits(claim.statement, locale)}</li>)}</ul> : <p className="mi-analysis-timeline__state">{empty}</p>}</section>
}

/**
 * Renders the frozen change record as readable rows.
 *
 * The stored record is a machine encoding, so it is never printed directly: each
 * row names the subject, the metric and both values with their units.
 */
function ChangeSection({ change, text }: Readonly<{ change: MarketAnalysisTimelineDetail['run']['change']; text: AnalysisDetailText }>): React.ReactElement {
  const entries = change ? formatChangeEntries(change, text.readableNames, text.readableLocale ?? 'zh-CN') : []
  // Only real value changes deserve a row. Observations entering and leaving the provider's
  // window are set churn, and listing them buried the two or three numbers that moved.
  const moved = entries.filter(entry => entry.kind === 'changed')
  const arrived = entries.filter(entry => entry.kind === 'added').length
  const left = entries.filter(entry => entry.kind === 'removed').length
  const structural = [...(change ? describeStructural(change, text) : []),
    ...(arrived > 0 ? [`${text.changeObservationsAdded} ${arrived}`] : []),
    ...(left > 0 ? [`${text.changeObservationsRemoved} ${left}`] : [])]
  const hasChange = moved.length > 0 || structural.length > 0
  return <section className="mi-analysis-timeline__change" data-analysis-change={hasChange ? 'changed' : 'none'} data-change-facts={moved.length}>
    <h3>{text.changeSummary}</h3>
    {!change || !hasChange ? <p>{text.noChange}</p> : null}
    {moved.length > 0 ? <>
      <p className="mi-analysis-timeline__section-label">{text.changeFacts}</p>
      <ul className="mi-analysis-change__list">
        {groupByDomain(moved).map(group => <li key={group.domainLabel} className="mi-analysis-change__group">
          <span className="mi-analysis-change__domain">{group.domainLabel}</span>
          <ul>
            {group.entries.map(entry => <li key={entry.key} className="mi-analysis-change__row" data-change-kind={entry.kind}>
              <span className="mi-analysis-change__label">{entry.label}</span>
              {/* `removed` carries only the value that left, `added` only the value that
                  arrived; only `changed` shows both sides of one fact. */}
              <span className="mi-analysis-change__previous">{entry.kind === 'added' ? '' : `−${entry.previous ?? ''}`}</span>
              <span className="mi-analysis-change__current">{entry.kind === 'removed' ? '' : entry.current ?? text.noChange}</span>
            </li>)}
          </ul>
        </li>)}
      </ul>
    </> : null}
    {structural.length > 0 ? <p className="mi-analysis-timeline__state">{text.changeStructural}：{structural.join('；')}</p> : null}
  </section>
}

function groupByDomain(entries: readonly MarketAnalysisChangeEntry[]): readonly { domainLabel: string; entries: readonly MarketAnalysisChangeEntry[] }[] {
  const groups: { domainLabel: string; entries: MarketAnalysisChangeEntry[] }[] = []
  for (const entry of entries) {
    const existing = groups.find(group => group.domainLabel === entry.domainLabel)
    if (existing) existing.entries.push(entry)
    else groups.push({ domainLabel: entry.domainLabel, entries: [entry] })
  }
  return groups
}

/** Domain, caveat and evidence movement, which has no value pair to show. */
function describeStructural(change: NonNullable<MarketAnalysisTimelineDetail['run']['change']>, text: AnalysisDetailText): readonly string[] {
  const parts: string[] = []
  if (change.missingDomainsAdded.length > 0) parts.push(`${text.changeDomainAdded} ${change.missingDomainsAdded.join('、')}`)
  if (change.missingDomainsRemoved.length > 0) parts.push(`${text.changeDomainRemoved} ${change.missingDomainsRemoved.join('、')}`)
  if (change.caveatsAdded > 0) parts.push(`${text.changeCaveatAdded} ${change.caveatsAdded}`)
  if (change.caveatsRemoved > 0) parts.push(`${text.changeCaveatRemoved} ${change.caveatsRemoved}`)
  if (change.evidenceRefsAdded > 0) parts.push(`${text.changeEvidenceAdded} ${change.evidenceRefsAdded}`)
  if (change.evidenceRefsRemoved > 0) parts.push(`${text.changeEvidenceRemoved} ${change.evidenceRefsRemoved}`)
  return parts
}
