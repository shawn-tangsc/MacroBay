import { Compass } from 'lucide-react'

import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'
import { localizeAnalysisMagnitudeUnits } from '../../../contracts/marketAnalysisReadableText'

import { analysisConclusionDirectionPolicy, analysisDirectionKey, localizedDirectionTerm, type AnalysisConclusionDirection } from './analysisConclusionDirectionPolicy'

/**
 * The operation directions: one row per horizon, so the reader gets "what to do next day, next week,
 * next month" instead of a single verdict that quietly means "right now".
 *
 * The direction term comes from the model and is one of the five the panel already colours; an
 * unexpected term is printed plainly rather than coloured, because guessing a colour from text is
 * exactly what `analysisConclusionDirectionPolicy` exists to prevent. A summary published before the
 * field existed renders nothing at all.
 */
export type AnalysisDirectionsText = Readonly<{
  title: string
  horizons: Readonly<Record<string, string>>
  /** Shown when the payload names a horizon this build does not know. */
  unknownHorizon: string
  confidence: Readonly<{ label: string } & Record<string, string>>
}>

export function AnalysisDirectionsBlock({ directions, text, hideLowConfidenceRows = false }: Readonly<{
  directions: readonly Readonly<{ horizon: string; direction: string; rationale: string; confidence: string }>[]
  text: AnalysisDirectionsText
  /**
   * Drop whole rows whose confidence is `low`. The reader's rule: a call the model itself rates low
   * is not worth showing on the at-a-glance card, and hiding only the label while keeping the row
   * would still read as advice. The detail drawer keeps every row.
   */
  hideLowConfidenceRows?: boolean
}>): React.ReactElement | null {
  const rows = hideLowConfidenceRows ? directions.filter(direction => direction.confidence !== 'low') : directions
  // Every row hidden means there is nothing to show, not an empty box.
  if (rows.length === 0) return null
  const language = useShellLanguage()
  const directionKey = (term: string): AnalysisConclusionDirection | undefined => analysisDirectionKey(term)
  return <section className="mi-analysis-directions" aria-label={text.title}>
    <p className="mi-analysis-directions__title"><Compass aria-hidden="true" size={13} />{text.title}</p>
    <ul>
      {rows.map(direction => {
        const key = directionKey(direction.direction)
        return <li key={direction.horizon} data-horizon={direction.horizon} data-direction={key ?? 'none'}
          style={key ? { '--mi-conclusion-direction': `var(${analysisConclusionDirectionPolicy.colorTokens[key]})` } as React.CSSProperties : undefined}>
          <span className="mi-analysis-directions__horizon">{text.horizons[direction.horizon] ?? text.unknownHorizon}</span>
          {/* The same pill the conclusion's own direction uses: one visual language for one vocabulary. */}
          <span className="mi-analysis-conclusion__direction mi-analysis-directions__direction">{localizedDirectionTerm(direction.direction, language)}</span>
          <span className="mi-analysis-directions__rationale">{localizeAnalysisMagnitudeUnits(direction.rationale, language)}</span>
          <span className="mi-analysis-directions__confidence">{text.confidence.label}
            {text.confidence[direction.confidence] ?? direction.confidence}</span>
        </li>
      })}
    </ul>
  </section>
}
