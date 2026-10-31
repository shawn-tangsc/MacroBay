import type {
  BriefingConclusion,
  BriefingCounterEvidence,
  BriefingMacroItem,
  BriefingMateriality,
  BriefingNewsItem,
  BriefingNewsSummary,
  BriefingNextItem,
  BriefingPulseRow,
  BriefingTopSignal,
  DailyBriefingDocument,
  DailyBriefingReadingId,
  DailyBriefingReadingState
} from '../../../contracts/dailyBriefing'
import { dailyBriefingPolicy } from '../../../contracts/dailyBriefing'
import type { DirectionAdvice } from '../../../contracts/marketAnalysisContracts'
import { baselineVisibility, leverageMateriality, policyPathMateriality } from './dailyBriefingDataSelection'
import { buildBriefingReadingRows } from './dailyBriefingMarketRows'
import type { DailyBriefingCalendarEvent, DailyBriefingFactPacket } from './dailyBriefingFactPacket'

export function buildDailyBriefingDocument(input: Readonly<{
  packet: DailyBriefingFactPacket
  date: string
  previous?: DailyBriefingDocument
}>): DailyBriefingDocument {
  const { packet, date } = input
  const readings = buildBriefingReadingRows(packet)
  const news = selectNews(packet)
  const macroCandidates = selectMacroCandidates(packet)
  const macro = selectMacro(packet, macroCandidates)
  const nextCandidates = selectNextCandidates(packet)
  const next = selectNext(packet, nextCandidates)
  const built = buildConclusion(packet)
  const policyPathData = buildPolicyPath(packet, input.previous)
  const leverage = buildLeverage(packet, readings.funds)
  const document: DailyBriefingDocument = Object.freeze({
    // Read from the policy rather than repeating the literals: a version bump that updates only one
    // of the two makes every read look stale, and the brief is regenerated on every poll.
    schemaVersion: dailyBriefingPolicy.schemaVersion,
    policyVersion: dailyBriefingPolicy.policyVersion,
    edition: Object.freeze({
      date,
      locale: packet.locale,
      generatedAt: packet.asOf,
      windowStart: packet.windowStart,
      windowEnd: packet.windowEnd,
      // Written from the packet, never recomputed from the current setting: a later settings change
      // must not reinterpret an edition that already exists.
      windowHours: packet.windowHours,
      timeZone: packet.timeZone
    }),
    status: buildStatus(packet, readings),
    lede: Object.freeze({
      source: 'template' as const,
      text: '',
      ...(input.previous?.lede.pattern ? { previousPattern: input.previous.lede.pattern } : {}),
      factCount: 0,
      generatedAt: packet.asOf
    }),
    news: Object.freeze({
      items: news,
      macro,
      ...(macroCandidates.length > 0 ? { macroCandidates } : {}),
      notes: Object.freeze({
        ...(news.length > 0 ? {} : { newsEmpty: newsEmptyCode(packet) }),
        ...(macro.length > 0 ? {} : { macroEmpty: macroEmptyCode(packet) })
      })
    }),
    data: Object.freeze({
      market: readings.market,
      funds: readings.funds,
      ...(leverage ? { leverage } : {}),
      ...(policyPathData ? { policyPath: policyPathData } : {}),
      sentiment: Object.freeze({
        fearGreed: readings.fearGreed,
        news: newsSummary(packet)
      })
    }),
    conclusion: built.conclusion,
    next: Object.freeze({
      items: next.items,
      ...(next.focus ? { focus: next.focus } : {}),
      ...(nextCandidates.length > 0 ? { candidates: nextCandidates } : {}),
      ...(next.items.length > 0 || next.focus ? {} : { note: nextEmptyCode(packet) })
    }),
    citations: built.citations,
    provenance: Object.freeze({
      summaryId: packet.conclusion?.summary.id ?? null,
      readAt: packet.asOf
    })
  })
  return input.previous ? Object.freeze({ ...document, comparison: buildComparison(document, input.previous) }) : document
}

function buildComparison(current: DailyBriefingDocument, previous: DailyBriefingDocument): DailyBriefingDocument['comparison'] {
  const value = (document: DailyBriefingDocument, id: string) =>
    document.data.funds.find((row) => row.id === id)?.value?.number ?? document.data.market.find((row) => row.id === id)?.value?.number
  const btcFunding = value(current, 'funding-btc'); const previousFunding = value(previous, 'funding-btc')
  const stablecoin = value(current, 'stablecoin'); const previousStablecoin = value(previous, 'stablecoin')
  const etfBtc = value(current, 'etf-btc'); const previousEtfBtc = value(previous, 'etf-btc')
  const currentDirection = current.conclusion?.direction
  const previousDirection = previous.conclusion?.direction
  const previousMacro = new Set(previous.news.macro.map((item) => item.eventKey))
  return Object.freeze({
    previousDate: previous.edition.date,
    directionChanged: currentDirection !== previousDirection,
    ...(previousDirection ? { previousDirection } : {}),
    ...(btcFunding !== undefined && previousFunding !== undefined ? { fundingBtcDelta: btcFunding - previousFunding } : {}),
    ...(stablecoin !== undefined && previousStablecoin !== undefined ? { stablecoinDelta: stablecoin - previousStablecoin } : {}),
    ...(etfBtc !== undefined && previousEtfBtc !== undefined ? { etfBtcDelta: etfBtc - previousEtfBtc } : {}),
    newMacroEvents: current.news.macro.filter((item) => !previousMacro.has(item.eventKey)).length
  })
}

function selectNews(packet: DailyBriefingFactPacket): readonly BriefingNewsItem[] {
  const seen = new Set<string>()
  return Object.freeze(packet.news.items
    .filter((item) => item.polarity !== 'neutral' && item.strength >= 2 && item.confidence >= 50)
    .sort((left, right) =>
      right.strength * right.confidence - left.strength * left.confidence ||
      right.publishedAt.localeCompare(left.publishedAt))
    .filter((item) => {
      const key = normalizeTitle(item.displayTitle ?? item.title)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, dailyBriefingPolicy.maximumNewsItems)
    .map((item) => Object.freeze({
      itemId: item.itemId,
      title: item.title,
      ...(item.displayTitle && item.displayTitle !== item.title ? { translatedTitle: item.displayTitle } : {}),
      sourceName: item.sourceName,
      publishedAt: item.publishedAt,
      polarity: item.polarity,
      strength: item.strength,
      confidence: item.confidence,
      symbols: Object.freeze([...item.symbols])
    })))
}

function selectMacroCandidates(packet: DailyBriefingFactPacket): readonly BriefingMacroItem[] {
  if (packet.calendar.state !== 'available') return Object.freeze([])
  const start = Date.parse(packet.windowStart)
  const end = Date.parse(packet.windowEnd)
  return Object.freeze(packet.calendar.events
    .filter((event) => event.lifecycleState === 'released' && event.importance === 'high' && Boolean(event.actual))
    .filter((event) => {
      const at = Date.parse(event.scheduledAt)
      return Number.isFinite(at) && at >= start && at < end
    })
    .sort((left, right) => surpriseMagnitude(right) - surpriseMagnitude(left) || right.scheduledAt.localeCompare(left.scheduledAt))
    .map((event) => toMacroItem(event)))
}

function selectMacro(packet: DailyBriefingFactPacket, candidates: readonly BriefingMacroItem[]): readonly BriefingMacroItem[] {
  return Object.freeze(candidates.slice(0, dailyBriefingPolicy.maximumMacroItems))
}

/**
 * The high-impact floor: the release with the largest surprise, and the latest release when the
 * surprise is equal. Selection and the final visibility pass both use this one ordering so a model
 * cannot silently hide every high-impact release.
 */
export function selectMacroFloorItem(items: readonly BriefingMacroItem[]): BriefingMacroItem | undefined {
  let floor: BriefingMacroItem | undefined
  for (const item of items) {
    if (item.importance !== 'high') continue
    if (!floor) {
      floor = item
      continue
    }
    const difference = surpriseMagnitude(item) - surpriseMagnitude(floor)
    if (difference > 0 || (difference === 0 && Date.parse(item.scheduledAt) > Date.parse(floor.scheduledAt))) floor = item
  }
  return floor
}

function toMacroItem(event: DailyBriefingCalendarEvent): BriefingMacroItem {
  return Object.freeze({
    eventKey: event.eventKey,
    title: event.title,
    ...(event.titleKey ? { titleKey: event.titleKey } : {}),
    scheduledAt: event.scheduledAt,
    importance: event.importance,
    ...(event.actual === undefined ? {} : { actual: event.actual }),
    ...(event.previous === undefined ? {} : { previous: event.previous }),
    ...(event.consensus === undefined ? {} : { consensus: event.consensus }),
    surprise: Object.freeze({ ...event.surprise })
  })
}

function selectNextCandidates(packet: DailyBriefingFactPacket): readonly BriefingNextItem[] {
  if (packet.calendar.state !== 'available') return Object.freeze([] as const)
  const today = localDate(packet.windowEnd, packet.timeZone)
  const horizon = addDays(today, 7)
  const candidates = packet.calendar.events
    .filter((event) => event.lifecycleState === 'scheduled' && event.importance === 'high')
    .filter((event) => {
      const at = Date.parse(event.scheduledAt)
      const day = localDate(event.scheduledAt, packet.timeZone)
      return Number.isFinite(at) && at > Date.parse(packet.windowEnd) && day <= horizon
    })
    .sort((left, right) => left.scheduledAt.localeCompare(right.scheduledAt))
    .map((event) => Object.freeze({
      eventKey: event.eventKey,
      title: event.title,
      ...(event.titleKey ? { titleKey: event.titleKey } : {}),
      at: event.scheduledAt,
      importance: event.importance,
      category: event.category,
      ...(event.countryCode ? { countryCode: event.countryCode } : {}),
      ...(event.countryName ? { countryName: event.countryName } : {}),
      ...(event.consensus ? { consensus: event.consensus } : {}),
      ...(event.previous ? { previous: event.previous } : {})
    }))
  return Object.freeze(candidates)
}

function selectNext(packet: DailyBriefingFactPacket, candidates: readonly BriefingNextItem[]): Readonly<{ items: readonly BriefingNextItem[]; focus?: BriefingNextItem }> {
  const focus = candidates[0]
  const items = candidates.filter((item) => item.eventKey !== focus?.eventKey).slice(0, dailyBriefingPolicy.maximumNextItems)
  return Object.freeze({ items: Object.freeze(items), ...(focus ? { focus } : {}) })
}

function buildConclusion(packet: DailyBriefingFactPacket): Readonly<{
  conclusion: BriefingConclusion | null
  citations: readonly Readonly<{ index: number; refId: string; sourceLabel?: string; observedAt?: string; itemId?: string; statement?: string }>[]
}> {
  const input = packet.conclusion
  if (!input) return Object.freeze({ conclusion: null, citations: Object.freeze([]) })
  const summary = input.summary
  const structured = summary.conclusion
  const direction = structured?.direction ?? input.direction ?? 'undecided'
  const directions = (structured ? summary.directions ?? [] : []).map((entry) => Object.freeze({
    horizon: entry.horizon,
    direction: entry.direction,
    confidence: entry.confidence
  }))
  const top = selectTopSignal(structured ? summary.directions ?? [] : [])
  const citations = new CitationCollector(input.evidenceRefs ?? [])
  const topSignal: BriefingTopSignal | null = top
    ? Object.freeze({
      horizon: top.horizon,
      direction: top.direction,
      confidence: top.confidence,
      rationale: top.rationale,
      citations: Object.freeze(citations.cite(top.evidenceRefIds, top.rationale))
    })
    : null
  const counterEvidence: readonly BriefingCounterEvidence[] = Object.freeze(summary.counterEvidence
    .slice(0, dailyBriefingPolicy.maximumCounterEvidence)
    .map((claim) => Object.freeze({
      statement: claim.statement,
      citations: Object.freeze(citations.cite([claim.evidenceRefId], claim.statement))
    })))
  const conclusion: BriefingConclusion = Object.freeze({
    summaryId: summary.id,
    publishedAt: summary.createdAt,
    direction,
    directions: Object.freeze(directions),
    summary: structured?.summary ?? summary.eventAssessment ?? '',
    ...(structured?.change ? { change: structured.change } : {}),
    conditions: Object.freeze((structured?.conditions ?? []).slice(0, dailyBriefingPolicy.maximumConditions)),
    invalidations: Object.freeze(input.predictions.slice(0, 4).map((prediction) => Object.freeze({
      asset: prediction.asset,
      horizonEnd: prediction.horizonEnd,
      text: prediction.invalidation
    }))),
    counterEvidence,
    topSignal,
    ...(structured?.evidenceStrength ? { evidenceStrength: structured.evidenceStrength } : {}),
    dataGaps: Object.freeze((structured?.dataGaps ?? []).slice(0, dailyBriefingPolicy.maximumGaps)),
    caveats: Object.freeze(summary.dataCaveats.slice(0, dailyBriefingPolicy.maximumCaveats))
  })
  return Object.freeze({ conclusion, citations: Object.freeze(citations.list()) })
}

function selectTopSignal(directions: readonly DirectionAdvice[]): DirectionAdvice | undefined {
  const rank: Readonly<Record<string, number>> = { high: 3, medium: 2, low: 1 }
  const order: Readonly<Record<string, number>> = { short: 0, medium: 1, long: 2 }
  const candidates = directions.filter((entry) => (rank[entry.confidence] ?? 0) >= 2)
  return candidates.sort((left, right) =>
    (rank[right.confidence] ?? 0) - (rank[left.confidence] ?? 0) ||
    (order[left.horizon] ?? 9) - (order[right.horizon] ?? 9))[0]
}

class CitationCollector {
  private readonly indexes = new Map<string, number>()
  private readonly evidence: ReadonlyMap<string, Readonly<{ sourceLabel?: string; observedAt?: string; itemId?: string }>>
  private readonly statements = new Map<string, string>()

  constructor(evidenceRefs: readonly Readonly<{ evidenceRefId: string; sourceLabel: string; itemId: string | null; occurredAt: string | null; publishedAt: string | null; visibleAt: string }>[]) {
    this.evidence = new Map(evidenceRefs.map((ref) => [ref.evidenceRefId, {
      sourceLabel: ref.sourceLabel,
      observedAt: ref.publishedAt ?? ref.occurredAt ?? ref.visibleAt,
      ...(ref.itemId ? { itemId: ref.itemId } : {})
    }]))
  }

  cite(refs: readonly string[], statement?: string): readonly number[] {
    const numbers: number[] = []
    for (const ref of refs) {
      if (!ref) continue
      if (statement && !this.statements.has(ref)) this.statements.set(ref, statement)
      let index = this.indexes.get(ref)
      if (index === undefined) {
        index = this.indexes.size + 1
        this.indexes.set(ref, index)
      }
      if (!numbers.includes(index)) numbers.push(index)
    }
    return Object.freeze(numbers)
  }

  list(): readonly Readonly<{ index: number; refId: string; sourceLabel?: string; observedAt?: string; itemId?: string; statement?: string }>[] {
    return Object.freeze([...this.indexes.entries()]
      .sort((left, right) => left[1] - right[1])
      .map(([refId, index]) => {
        const evidence = this.evidence.get(refId)
        return Object.freeze({
          index,
          refId,
          ...(evidence?.sourceLabel ? { sourceLabel: evidence.sourceLabel } : {}),
          ...(evidence?.observedAt ? { observedAt: evidence.observedAt } : {}),
          ...(evidence?.itemId ? { itemId: evidence.itemId } : {}),
          ...(this.statements.has(refId) ? { statement: this.statements.get(refId)! } : {})
        })
      }))
  }
}

function newsSummary(packet: DailyBriefingFactPacket): BriefingNewsSummary {
  const counts = { bearish: 0, bullish: 0, mixed: 0, neutral: 0 }
  for (const item of packet.news.items) counts[item.polarity] += 1
  return Object.freeze({
    state: packet.news.state,
    counts: Object.freeze(counts),
    itemCount: packet.news.items.length
  })
}

function buildStatus(
  packet: DailyBriefingFactPacket,
  readings: ReturnType<typeof buildBriefingReadingRows>
): DailyBriefingDocument['status'] {
  const fearGreed = readings.fearGreed?.state ?? 'unavailable'
  const funding = combine((readings.funds ?? []).filter((row) => row.id === 'funding-btc' || row.id === 'funding-eth').map((row) => row.state))
  const capital = combine((readings.funds ?? []).filter((row) => row.id !== 'funding-btc' && row.id !== 'funding-eth').map((row) => row.state))
  const calendar = packet.enabled.calendar ? packet.calendar.state : 'source-disabled'
  const list: ReadonlyArray<{ id: DailyBriefingReadingId; state: DailyBriefingReadingState }> = [
    { id: 'fear-greed', state: fearGreed },
    { id: 'funding', state: funding },
    { id: 'capital', state: capital },
    { id: 'calendar', state: calendar }
  ]
  return Object.freeze({
    readings: Object.freeze(list.map((entry) => Object.freeze(entry))),
    readingsAvailable: list.filter((entry) => entry.state === 'available').length,
    readingsTotal: 4
  })
}

function combine(states: readonly DailyBriefingReadingState[]): DailyBriefingReadingState {
  if (states.length === 0) return 'unavailable'
  if (states.every((state) => state === 'source-disabled')) return 'source-disabled'
  if (states.some((state) => state === 'available')) return 'available'
  if (states.some((state) => state === 'stale')) return 'stale'
  return 'unavailable'
}

function localDate(instant: string, timeZone: string): string {
  const parsed = Date.parse(instant)
  if (!Number.isFinite(parsed)) return ''
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(parsed))
  } catch {
    return new Date(parsed).toISOString().slice(0, 10)
  }
}

function addDays(date: string, days: number): string {
  const parsed = Date.parse(`${date}T00:00:00.000Z`)
  return Number.isFinite(parsed) ? new Date(parsed + days * 24 * 60 * 60 * 1_000).toISOString().slice(0, 10) : date
}

function newsEmptyCode(packet: DailyBriefingFactPacket): string {
  if (packet.news.state === 'source-disabled') return 'news-source-disabled'
  if (packet.news.state === 'unavailable') return 'news-unavailable'
  return 'no-directional-news'
}

function macroEmptyCode(packet: DailyBriefingFactPacket): string {
  if (packet.calendar.state === 'source-disabled') return 'calendar-source-disabled'
  if (packet.calendar.state === 'unavailable') return 'calendar-unavailable'
  return 'past-24h-no-high-impact-release'
}

function nextEmptyCode(packet: DailyBriefingFactPacket): string {
  if (packet.calendar.state === 'source-disabled') return 'calendar-source-disabled'
  if (packet.calendar.state === 'unavailable') return 'calendar-unavailable'
  return 'next-7d-no-high-impact-event'
}

function surpriseMagnitude(event: Readonly<{ surprise: BriefingMacroItem['surprise'] }>): number {
  if (event.surprise.unit === 'pp' && typeof event.surprise.value === 'number') return Math.abs(event.surprise.value)
  if (event.surprise.unit === 'relative-percent' && typeof event.surprise.value === 'number') return Math.abs(event.surprise.value) / 10
  return event.surprise.direction === 'inline' || event.surprise.direction === 'consensus-unavailable' ? 0 : 1
}

function normalizeTitle(value: string): string {
  return value.trim().toLowerCase().replace(/[\s\p{P}]+/gu, '')
}

function buildPolicyPath(
  packet: DailyBriefingFactPacket,
  previous: DailyBriefingDocument | undefined
): DailyBriefingDocument['data']['policyPath'] {
  const policyPath = packet.policyPath
  const probability = policyPath?.probability
  if (!policyPath || !probability) return undefined
  const current = probability.value <= 1 ? probability.value * 100 : probability.value
  const previousProbability = previous?.data.policyPath?.probability
  const probabilityChangePp = typeof previousProbability === 'number' && Number.isFinite(previousProbability)
    ? Math.round((current - previousProbability) * 10) / 10
    : undefined
  const materiality = policyPathMateriality({
    meetingDate: policyPath.meetingDate,
    outcome: probability.outcome,
    previousOutcome: previous?.data.policyPath?.outcome,
    probabilityChangePp,
    windowEnd: packet.windowEnd
  })
  return Object.freeze({
    state: 'available' as const,
    meetingDate: policyPath.meetingDate,
    outcome: probability.outcome,
    probability: current,
    observedAt: probability.asOf,
    ...(policyPath.targetRange ? { targetLower: policyPath.targetRange.lowerPercent, targetUpper: policyPath.targetRange.upperPercent } : {}),
    ...(probabilityChangePp !== undefined ? { probabilityChangePp } : {}),
    materiality,
    ...baselineVisibility(materiality)
  })
}

function buildLeverage(
  packet: DailyBriefingFactPacket,
  funds: readonly BriefingPulseRow[]
): NonNullable<DailyBriefingDocument['data']['leverage']> | undefined {
  const positioning = packet.positioning
  if (!positioning || positioning.state !== 'available') {
    if (positioning?.state !== 'empty') return undefined
    // An empty positioning read is a gap, not a flat market: keep the row so the reader sees the
    // hole instead of a silently complete data section.
    const gap: BriefingMateriality = Object.freeze({ material: true, reasonCode: 'gap' as const })
    return Object.freeze({ state: 'unavailable' as const, btc: {}, eth: {}, materiality: gap, ...baselineVisibility(gap, true) })
  }
  const funding = (id: string) => {
    const row = funds.find((candidate) => candidate.id === id)
    return row?.value?.number
  }
  const last = (rows: readonly { notionalUsd: number }[]) => rows.at(-1)?.notionalUsd
  const change = positioning.change
  const materiality = leverageMateriality({
    funding: funds,
    openInterestChange24hPct: { btc: change?.btc.h24Pct, eth: change?.eth.h24Pct }
  })
  return Object.freeze({
    state: 'available' as const,
    materiality,
    ...baselineVisibility(materiality),
    observedAt: positioning.btc.at(-1)?.observedAt ?? positioning.eth.at(-1)?.observedAt,
    btc: Object.freeze({ ...(funding('funding-btc') !== undefined ? { fundingRate: funding('funding-btc') } : {}), ...(last(positioning.btc) !== undefined ? { openInterestUsd: last(positioning.btc) } : {}), ...(positioning.change?.btc.h1Pct !== undefined ? { change1hPct: positioning.change.btc.h1Pct } : {}), ...(positioning.change?.btc.h24Pct !== undefined ? { change24hPct: positioning.change.btc.h24Pct } : {}) }),
    eth: Object.freeze({ ...(funding('funding-eth') !== undefined ? { fundingRate: funding('funding-eth') } : {}), ...(last(positioning.eth) !== undefined ? { openInterestUsd: last(positioning.eth) } : {}), ...(positioning.change?.eth.h1Pct !== undefined ? { change1hPct: positioning.change.eth.h1Pct } : {}), ...(positioning.change?.eth.h24Pct !== undefined ? { change24hPct: positioning.change.eth.h24Pct } : {}) })
  })
}
