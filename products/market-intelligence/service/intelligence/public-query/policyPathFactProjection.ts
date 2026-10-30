import {
  MARKET_ANALYSIS_CONTEXT_CAVEATS,
  MARKET_ANALYSIS_POLICY_PATH_POLICY,
  type AgentFact
} from '../../../contracts/marketAnalysisContracts'
import type { PolicyPathContextRead, PolicyPathReading } from '../policy-path/policyPathQueryService'
import { mergeDomainObservation, observation, type MarketAnalysisDomainObservation } from './domainObservationMerge'
import { fact } from './marketAnalysisContextProjection'

const METRICS = MARKET_ANALYSIS_POLICY_PATH_POLICY.metrics
const SOURCE_ID = MARKET_ANALYSIS_POLICY_PATH_POLICY.sourceId

/** The public pages a reader can open to check each class of policy fact. */
export const POLICY_PATH_SOURCE_URLS = Object.freeze({
  calendar: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',
  fredTargetUpper: 'https://fred.stlouisfed.org/series/DFEDTARU',
  fredTargetLower: 'https://fred.stlouisfed.org/series/DFEDTARL',
  polymarket: 'https://polymarket.com/'
} as const)

const ALLOWED_HOSTS = Object.freeze(['federalreserve.gov', 'fred.stlouisfed.org', 'polymarket.com'])

type PolicyFactDraft = Readonly<{
  metric: string
  subject: string
  value: string | number
  unit: string | null
  observedAt: string
  sourceUrl?: string
  suffix: string
}>

type Projection = Readonly<{
  asOf: string
  facts: AgentFact[]
  caveats: Set<string>
  observations: Partial<Record<'macro', MarketAnalysisDomainObservation>>
}>

/**
 * Projects the policy path into macro facts.
 *
 * Every value keeps the instant it describes: the odds carry the observation's `at`, the SEP carries
 * the publishing meeting, the range and vote carry the decision date, and the next meeting carries the
 * analysis boundary. That is what lets a conclusion say "市场定价 71%，截至 …" instead of an
 * unfalsifiable percentage, and it is why this projection runs before the snapshot is frozen.
 *
 * The set is capped on purpose. These facts are contextual — they explain a meeting, not an intraday
 * move — so they may not crowd out the domains that do. A reading that exceeds the fixed share is
 * truncated here, with a caveat, rather than silently dropped by the global budget later.
 */
export function projectPolicyPath(
  read: PolicyPathContextRead | undefined,
  asOf: string,
  facts: AgentFact[],
  caveats: Set<string>,
  observations: Partial<Record<'macro', MarketAnalysisDomainObservation>>
): void {
  if (!read || read.state === 'disabled') return
  const projection: Projection = { asOf, facts, caveats, observations }
  if (read.state === 'unavailable') {
    caveats.add(MARKET_ANALYSIS_CONTEXT_CAVEATS.policyPathUnavailable)
    observations.macro = mergeDomainObservation(observations.macro,
      observation('unavailable', 'unavailable', 0, 0, [MARKET_ANALYSIS_CONTEXT_CAVEATS.policyPathUnavailable]))
    return
  }
  const reading = read.reading
  const drafts: PolicyFactDraft[] = []
  const add = (draft: PolicyFactDraft): void => { drafts.push(draft) }
  const probability = reading.probability
  const probabilityUrl = probability?.venue === 'polymarket' ? safeUrl(POLICY_PATH_SOURCE_URLS.polymarket, caveats) : undefined
  if (probability) {
    caveats.add(MARKET_ANALYSIS_POLICY_PATH_POLICY.caveats.oddsAreMarketPricing)
    const value = percent(probability.value)
    add({
      metric: METRICS.impliedProbability, subject: probability.outcome, value, unit: '%',
      observedAt: probability.asOf, ...(probabilityUrl ? { sourceUrl: probabilityUrl } : {}),
      suffix: reading.meetingDate
    })
    if (probability.changeInPp24h === undefined) {
      caveats.add(MARKET_ANALYSIS_CONTEXT_CAVEATS.policyPathChange24hUnavailable)
    } else {
      add({
        metric: METRICS.probabilityChange24h, subject: probability.outcome, value: probability.changeInPp24h, unit: 'pp',
        observedAt: probability.asOf, ...(probabilityUrl ? { sourceUrl: probabilityUrl } : {}),
        suffix: `${reading.meetingDate}-change-24h`
      })
    }
  }
  add({
    metric: METRICS.nextMeetingDate, subject: 'fomc', value: reading.meetingDate, unit: null,
    observedAt: asOf, sourceUrl: POLICY_PATH_SOURCE_URLS.calendar, suffix: reading.meetingDate
  })
  const statementUrl = safeUrl(reading.lastDecision?.statementUrl, caveats)
  const decisionDate = decisionDateOf(reading, asOf)
  if (reading.targetRange) {
    add({
      metric: METRICS.targetRange, subject: 'fomc',
      value: `${reading.targetRange.lowerPercent.toFixed(2)}%-${reading.targetRange.upperPercent.toFixed(2)}%`,
      unit: null, observedAt: decisionDate,
      ...(statementUrl
        ? { sourceUrl: statementUrl }
        : { sourceUrl: POLICY_PATH_SOURCE_URLS.fredTargetUpper }),
      suffix: decisionDate.slice(0, 10)
    })
  } else {
    caveats.add(MARKET_ANALYSIS_CONTEXT_CAVEATS.policyPathRangeUnavailable)
  }
  if (reading.sep) {
    caveats.add(MARKET_ANALYSIS_POLICY_PATH_POLICY.caveats.projectionsFromLatestSepMeeting)
    const sep = reading.sep
    const sepDate = `${sep.asOf}T00:00:00.000Z`
    const sepUrl = safeUrl(sep.sourceUrl, caveats)
    const median = sep.medianCurrentYear
    if (median !== undefined) {
      add({
        metric: METRICS.sepMedianCurrentYear, subject: 'fomc', value: median, unit: '%',
        observedAt: sepDate, ...(sepUrl ? { sourceUrl: sepUrl } : {}), suffix: sep.asOf
      })
    }
    const path = medianPathText(sep.medianPath)
    if (path) {
      add({
        metric: METRICS.sepMedianPath, subject: 'fomc', value: path, unit: null,
        observedAt: sepDate, ...(sepUrl ? { sourceUrl: sepUrl } : {}), suffix: `${sep.asOf}-path`
      })
    }
  } else {
    caveats.add(MARKET_ANALYSIS_CONTEXT_CAVEATS.policyPathSepUnavailable)
  }
  if (reading.lastDecision?.vote) {
    const vote = reading.lastDecision.vote
    const dissents = (reading.lastDecision.dissents ?? []).map(dissent => `${dissent.name} 主张${preferenceText(dissent.preferred)}`)
    add({
      metric: METRICS.lastDecisionVote, subject: 'fomc',
      value: `${vote.for}-${vote.against}${dissents.length > 0 ? `（反对：${dissents.join('、')}）` : ''}`,
      unit: null, observedAt: decisionDate,
      ...(statementUrl ? { sourceUrl: statementUrl } : {}),
      suffix: decisionDate.slice(0, 10)
    })
  }
  const kept = withinBudget(drafts, caveats)
  let count = 0
  for (const draft of kept) {
    projection.facts.push(fact('macro', draft.subject, draft.metric, draft.value, draft.unit, SOURCE_ID,
      draft.observedAt, projection.asOf, 'comparable', draft.suffix, {
        identityFromEventOnly: true,
        ...(draft.sourceUrl ? { sourceUrl: draft.sourceUrl } : {})
      }))
    count += 1
  }
  if (count === 0) {
    caveats.add(MARKET_ANALYSIS_CONTEXT_CAVEATS.policyPathUnavailable)
    observations.macro = mergeDomainObservation(observations.macro,
      observation('unavailable', 'unavailable', 0, 0, [MARKET_ANALYSIS_CONTEXT_CAVEATS.policyPathUnavailable]))
    return
  }
  const domainCaveats = [...caveats].filter(caveat => caveat.startsWith('policy-') || caveat === 'odds-are-market-pricing' || caveat === 'projections-from-latest-sep-meeting')
  observations.macro = mergeDomainObservation(observations.macro,
    observation('available', 'fresh', count, 0, domainCaveats))
}

/** The fixed share: at most eight facts and 900 characters of prompt text. */
function withinBudget(drafts: readonly PolicyFactDraft[], caveats: Set<string>): readonly PolicyFactDraft[] {
  const byCount = drafts.slice(0, MARKET_ANALYSIS_POLICY_PATH_POLICY.maximumFacts)
  const kept: PolicyFactDraft[] = []
  let characters = 0
  for (const draft of byCount) {
    const cost = JSON.stringify({ metric: draft.metric, value: draft.value, unit: draft.unit, observedAt: draft.observedAt }).length
    if (kept.length > 0 && characters + cost > MARKET_ANALYSIS_POLICY_PATH_POLICY.maximumPromptCharacters) break
    kept.push(draft)
    characters += cost
  }
  if (kept.length < drafts.length) caveats.add(MARKET_ANALYSIS_CONTEXT_CAVEATS.policyPathTruncated)
  return kept
}

function percent(value: number): number {
  return Math.round(value * 1000) / 10
}

function decisionDateOf(reading: PolicyPathReading, asOf: string): string {
  const match = reading.lastDecision?.statementUrl
    ? /monetary(\d{4})(\d{2})(\d{2})a\.htm/.exec(reading.lastDecision.statementUrl)
    : null
  return match ? `${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z` : reading.probability?.asOf ?? asOf
}

function medianPathText(path: Readonly<Record<string, number>> | undefined): string | undefined {
  if (!path) return undefined
  const parts = Object.keys(path).sort()
    .filter(key => /^y\d{4}$/.test(key) && typeof path[key] === 'number')
    .map(key => `${key.slice(1)} 年 ${path[key]}%`)
  if (typeof path.longerRun === 'number') parts.push(`长期 ${path.longerRun}%`)
  return parts.length > 0 ? parts.join('；') : undefined
}

function preferenceText(preferred: 'raise' | 'lower' | 'maintain'): string {
  if (preferred === 'raise') return '加息'
  return preferred === 'lower' ? '降息' : '维持'
}

function safeUrl(candidate: string | undefined, caveats: Set<string>): string | undefined {
  if (!candidate) return undefined
  try {
    const url = new URL(candidate)
    if (url.protocol !== 'https:' || !ALLOWED_HOSTS.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
      throw new Error('host')
    }
    return candidate
  } catch {
    caveats.add(MARKET_ANALYSIS_CONTEXT_CAVEATS.policyPathSourceUrlInvalid)
    return undefined
  }
}
