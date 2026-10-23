import type { ReactElement } from 'react'

import type { productText } from '../../../shared/i18n/productText'
import type { CrossAssetReading } from '../../../../contracts/crossAssetObservationContracts'
import { crossAssetMagnitudeValue, crossAssetSignedValue } from './crossAssetFormat'

type Text = typeof productText['zh-CN' | 'en-US']['pages']['intelligence']['portal']['dashboard']['crossAsset']

/** Fills a copy template's placeholders: the sentence structure stays in the i18n registry, word order included. */
function fill(template: string | undefined, values: Readonly<Record<string, string>>): string {
  // 契约里的 id 若还没有文案，这里返回空串而不是抛：一句没登记的 id 不该把整块判读打崩。
  if (template === undefined) return ''
  return Object.entries(values).reduce((text, [key, value]) => text.replace(`{${key}}`, value), template)
}

/**
 * The reading line under the chart (design 142 §6, the reader's choice: B1).
 *
 * One line spanning the panel, no card: a single rule above it and 6px of padding, so it reads as a footnote
 * to the chart rather than as another block competing with the analysis beside it. It carries the verdict,
 * the scenarios that are one leg away ("不像 钱变贵（黄金涨了 0.86%）"), the relative returns, and the ρ
 * backing with its own horizon — and nothing else.
 *
 * Two rules it must keep:
 *
 * - **ρ is never shown outside 24H.** The correlation is always the 24h/5m one, so putting it beside a 1H or
 *   7D judgement would mix horizons in one sentence — the same mistake as the daily-rate row that stated two
 *   trading days at once. The non-24H state says why instead.
 * - **It never states a verdict it cannot back.** Missing or stale legs, and combinations no scenario
 *   describes, come out as the product saying it cannot tell — with the leg named — rather than as a guess.
 */
export function CrossAssetReadingLine({ reading, text }: { reading: CrossAssetReading; text: Text }): ReactElement {
  const copy = text.reading
  const scenarioName = (id: string): string => (copy.scenarios as Record<string, string>)[id] ?? id
  const legName = (leg: string): string => (copy.legs as Record<string, string>)[leg] ?? leg
  const refutedText = (scenario: string, leg: string, direction?: string): string => {
    const value = direction === undefined ? '' : (copy.directions as Record<string, string>)[direction] ?? direction
    const legReading = reading.state === 'judged' ? reading.legs.find(item => item.leg === leg) : undefined
    return fill(copy.refuted, {
      scenario: scenarioName(scenario), leg: legName(leg),
      // "没变化" needs no number, so the number lives in the direction phrase rather than in this template.
      direction: value.replace('{value}', legReading === undefined ? '' : crossAssetMagnitudeValue(legReading.returnPercent, '%')).trim()
    })
  }
  /** The verdict with the scenario name emphasised where it actually falls in the translated sentence. */
  const verdict = (): ReactElement => {
    if (reading.state !== 'judged') {
      return <p className="mi-cross-asset__reading-verdict" data-reading-reason={reading.reason}>
        {fill(copy.undetermined[reading.reason], { leg: reading.leg === undefined ? '' : legName(reading.leg) })}
      </p>
    }
    const name = scenarioName(reading.scenario)
    const sentence = fill(copy.verdict, { scenario: name, story: copy.stories[reading.scenario] })
    const at = sentence.indexOf(name)
    return <p className="mi-cross-asset__reading-verdict" data-reading-scenario={reading.scenario}>
      {sentence.slice(0, at)}<b>{name}</b>{sentence.slice(at + name.length)}
    </p>
  }
  const correlation = reading.state === 'judged' ? reading.correlation : undefined
  return <section className="mi-cross-asset__reading" data-cross-asset-region="reading" data-reading-state={reading.state}>
    <h3>{copy.title}</h3>
    {verdict()}
    {reading.state === 'judged'
      ? reading.notices.map(notice => <small key={notice} data-reading-notice={notice}>{(copy.notices as Record<string, string>)[notice] ?? notice}</small>)
      : null}
    {/* Only the scenarios one leg away are worth naming: two legs off is plainly "not it".
        With a verdict, each near miss gets a row with its leg and number. Without one, the reader is owed the
        closest scenario *and* the leg that stopped it — every entry in that list is exactly one leg away, so
        naming them all would repeat the same sentence instead of adding anything. */}
    {reading.state === 'judged'
      ? <ul className="mi-cross-asset__reading-refuted">
        {reading.refuted.map(item => <li key={`${item.scenario}-${item.leg}`} data-reading-refuted={item.scenario}>
          {refutedText(item.scenario, item.leg, reading.legs.find(leg => leg.leg === item.leg)?.direction)}
        </li>)}
      </ul>
      : <>
        {/* The fallback: with no scenario fitting, say what the legs actually did ("every line is inside
            its own usual range", "only the index moved") rather than only that the product cannot tell —
            the reader can check every clause against the table beside it. */}
        {reading.legs === undefined ? null : <p className="mi-cross-asset__reading-fallback" data-reading-fallback={reading.legs.filter(leg => leg.direction !== 'flat').length}>
          {(() => {
            const moved = reading.legs.filter(leg => leg.direction !== 'flat')
            if (moved.length === 0) return copy.noDriverNone
            const detail = moved.map(leg => `${legName(leg.leg)}${(copy.directions as Record<string, string>)[leg.direction]
              .replace('{value}', crossAssetMagnitudeValue(leg.returnPercent, '%'))}`).join(' · ')
            return moved.length === 1
              ? fill(copy.noDriverOne, { direction: detail })
              : fill(copy.noDriverSeveral, { detail })
          })()}
        </p>}
        {reading.refuted.length > 0 ? <p className="mi-cross-asset__reading-nearest" data-reading-nearest={reading.refuted[0]!.scenario}>
          {fill(copy.nearestMiss, { scenario: scenarioName(reading.refuted[0]!.scenario), leg: legName(reading.refuted[0]!.leg) })}
        </p> : null}
      </>}
    {reading.state === 'judged' ? <p className="mi-cross-asset__reading-relative">{fill(copy.relative, {
      btcMinusIndex: reading.relativeReturns.btcMinusIndex === null ? text.windowNoData : crossAssetSignedValue(reading.relativeReturns.btcMinusIndex, text.pp),
      ethMinusBtc: reading.relativeReturns.ethMinusBtc === null ? text.windowNoData : crossAssetSignedValue(reading.relativeReturns.ethMinusBtc, text.pp)
    })}</p> : null}
    {/* ρ belongs to the 24h window only; outside it the sentence above already said why there is none. */}
    {correlation !== undefined ? <small className="mi-cross-asset__reading-correlation" data-reading-correlation={correlation.state}>
      {correlation.state === 'available'
        ? fill(copy.correlation, {
          value: correlation.value.toFixed(2), window: correlation.window, interval: correlation.interval,
          samples: String(correlation.sampleCount), expected: String(correlation.expectedCount)
        })
        : copy.correlationUnavailable}
    </small> : null}
  </section>
}
