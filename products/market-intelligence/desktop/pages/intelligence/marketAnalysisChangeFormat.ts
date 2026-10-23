import {
  formatReadableAnalysisValue,
  formatReadableUsdAmount,
  isSignedAnalysisMetric,
  marketAnalysisReadableTextPolicy,
  readableAnalysisName,
  type MarketAnalysisReadableLocale,
  type MarketAnalysisReadableNames
} from '../../../contracts/marketAnalysisReadableText'
import type { MarketAnalysisChangeView } from '../../shared/ipc/marketAnalysisTimelineClient'
import { marketCalendarPublicPolicy } from '../../../contracts/macro/marketCalendarQueryContracts'

/**
 * Display policy for the frozen change record.
 *
 * The stored record is a machine encoding (`~actual:3.2->3.4`) meant for the model and for
 * hashing. Reading it needs a human name for the domain, the subject and the metric plus a
 * value with its unit. The names are copy, so they come from the caller's product i18n
 * registry (the model prompt has its own Chinese vocabulary, because the main process must not
 * import renderer code); only the behavior that is not copy lives here.
 */
export const marketAnalysisChangePolicy = Object.freeze({
  maximumTextCharacters: marketAnalysisReadableTextPolicy.maximumTextCharacters,
  signedMetrics: marketAnalysisReadableTextPolicy.signedMetrics
})

/** A change row ready to render: no fact ids, no evidence ids, no raw integers. */
export type MarketAnalysisChangeEntry = Readonly<{
  key: string
  domainLabel: string
  label: string
  kind: 'added' | 'removed' | 'changed'
  previous: string | null
  current: string | null
}>

export function formatChangeEntries(
  view: MarketAnalysisChangeView,
  names: MarketAnalysisReadableNames,
  locale: MarketAnalysisReadableLocale = 'zh-CN'
): readonly MarketAnalysisChangeEntry[] {
  const name = (fact: MarketAnalysisChangeView['facts'][number]): string => {
    // The fact's own name when it has one: a calendar observation's subject is only its kind
    // (`economic-indicator`), so without this a reader is told that "an economic indicator" changed and
    // never which one — three different indicators render as three identical rows.
    const subject = fact.subjectLabel ?? readableAnalysisName(names, 'subject', fact.subject)
    return [subject, readableAnalysisName(names, 'metric', fact.metric)].filter(Boolean).join(' · ')
  }
  /**
   * A change row that cannot name its subject is not shown.
   *
   * Calendar facts whose subject is only the *kind* of calendar item (`economic-indicator`) name
   * nothing on their own: three different indicators publishing at once rendered as three identical
   * rows reading 「经济指标 · 生命周期 待公布 → 已公布」. They come back the moment a fact carries its own
   * name (`subjectLabel`, produced by the projection — design 141): this hides what cannot be said, it
   * does not decide that it should never be said.
   *
   * The kinds themselves are the calendar contract's list, not a second copy of it: a kind added
   * there must be hidden here too, and a list retyped here would silently stop covering it.
   */
  const namesSomething = (fact: MarketAnalysisChangeView['facts'][number]): boolean =>
    Boolean(fact.subjectLabel) || fact.subject === null || !calendarSubjectIsAKind(fact.subject)

  // One row per fact change, never a fused pair. This used to merge a removal and an addition
  // that shared a label, because fact ids carried the observation date and so a new value
  // arrived as a remove plus an add. Fact identity is stable now, a real value change arrives
  // as `changed` on one id, and merging the rest invented movements that never happened: two
  // unrelated indicators with the same generic subject and metric were shown as `1716 -> 462`.
  return view.facts.filter(namesSomething).map(fact => ({
    key: `${fact.domain}:${fact.subject ?? ''}:${fact.metric}`,
    domainLabel: readableAnalysisName(names, 'domain', fact.domain) ?? fact.domain,
    label: name(fact),
    kind: fact.kind,
    previous: fact.previousValue === null ? null : formatChangeValue(fact.previousValue, fact.unit, locale, signed(fact.metric)),
    current: fact.value === null ? null : formatChangeValue(fact.value, fact.unit, locale, signed(fact.metric))
  }))
}

/** Formats a stored value for display using its recorded unit. */
export function formatChangeValue(value: string | number, unit: string | null, locale: MarketAnalysisReadableLocale = 'zh-CN', signed = true): string {
  return formatReadableAnalysisValue(value, unit, locale, signed)
}

/** True when a metric's sign carries meaning, as opposed to a level. */
function signed(metric: string): boolean {
  return isSignedAnalysisMetric(metric)
}

/** Formats a USD amount with a magnitude prefix. */
export function formatUsdAmount(value: number, locale: MarketAnalysisReadableLocale = 'zh-CN', signed = true): string {
  return formatReadableUsdAmount(value, locale, signed)
}

/**
 * True while a subject is only the kind of calendar item a fact came from — the contract's own list,
 * so a kind it grows is covered here without a second edit.
 */
function calendarSubjectIsAKind(subject: string): boolean {
  return (marketCalendarPublicPolicy.kinds as readonly string[]).includes(subject)
}
